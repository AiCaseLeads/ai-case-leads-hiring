import { withRequiredApplicationFields } from "../../lib/hiring/contact-fields";
import test from "node:test";
import assert from "node:assert/strict";
import { createStore, jobInput, applicationInput, MANAGER } from "../hub/fixtures";
import { handleHubRequest } from "../../lib/hub/http";
import { handleJobSetup } from "../../lib/job-setup/http";
import { sealToken } from "../../lib/google/oauth";
import { matchDetail, processAiMatches, reconcileMatches, type MatchDeps } from "../../lib/ai/matching";
import type { HubJob } from "../../lib/hub/types";

const origin = "https://jobs.example.invalid", encryptionKey = "c".repeat(64);
const criterion = "Build React applications", resume = "Built React applications for two years.";
type Api = "hub PATCH" | "wizard POST";
function request(path: string, method: string, input: unknown) {
  return new Request(origin + path, { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
}
async function fixture() {
  const f = createStore();
  const input = { ...jobInput(), aiMatchEnabled: true, descriptionHtml: "<p>Build React applications and maintain tested production websites.</p>" };
  const job = await f.store.saveJob(input);
  const readyId = (await f.store.acceptApplication(applicationInput(job.id))).id;
  const needsReviewId = (await f.store.acceptApplication(applicationInput(job.id))).id;
  const fileId = "e".repeat(64);
  await f.store.stmt("INSERT INTO hub_files(id,job_id,field_path,application_id,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES(?,?,'_systemfield_resume',?,'resume.pdf','application/pdf',20,?,?,9999999999999,'test')", fileId, job.id, readyId, fileId, Date.now()).run();
  const app = await f.store.getApplication(readyId);
  await f.store.stmt("UPDATE hub_applications SET answers_json=? WHERE id=?", JSON.stringify([...app.answers, { path: "_systemfield_resume", value: fileId }]), readyId).run();
  await f.store.setSetting("ai_openrouter_config_v1", { enabled: true, sealedKey: await sealToken("sk-or-isolated-test-credential", encryptionKey) });
  await reconcileMatches(f.store);
  await f.store.stmt("UPDATE hub_ai_criteria SET status='ready',criteria_json=? WHERE job_id=? AND form_version=?", JSON.stringify([criterion]), job.id, job.formVersion).run();
  let providerCalls = 0, pdfReads = 0;
  const deps: MatchDeps = {
    store: f.store, encryptionKey,
    readPdf: async (_appId, id) => { pdfReads++; return { status: "ready", text: resume, pages: 1, truncated: false, message: "Read", fileId: id, filename: "resume.pdf", cached: false }; },
    fetcher: async (_url, init) => {
      providerCalls++;
      const body = JSON.parse(String(init!.body));
      const result = body.response_format.json_schema.name === "job_requirements"
        ? { criteria: [{ criterion, quote: criterion }] }
        : { criteria: [{ criterion, status: "evidence_found", explanation: "Résumé reports React work.", citations: [{ id: "resume:0" }] }], checks: [] };
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] });
    },
  };
  await processAiMatches(deps);
  assert.equal((await matchDetail(f.store, readyId)).status, "ready");
  assert.equal((await matchDetail(f.store, needsReviewId)).status, "needs_review");
  assert.equal(providerCalls, 1);
  return { ...f, input, job, readyId, needsReviewId, deps, metrics: () => ({ providerCalls, pdfReads }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function edit(f: Fixture, api: Api, prior: HubJob, patch: Record<string, unknown>, creationId = crypto.randomUUID()) {
  if (api === "hub PATCH") return handleHubRequest(request(`/api/hub/jobs/${prior.id}`, "PATCH", { formVersion: prior.formVersion, lifecycleRevision: prior.lifecycle?.revision || 0, ...patch }), ["jobs", prior.id], MANAGER, f.store);
  const { location, ...jobPatch } = patch;
  return handleJobSetup(request("/api/job-setup", "POST", {
    action: "save", creationId, jobId: prior.id, formVersion: prior.formVersion,
    expectedLifecycleRevision: prior.lifecycle?.revision || 0, expectedBinding: null, scorecard: null,
    location: typeof location === "string" ? { workModel: "remote", country: location.includes("Spain") ? "Spain" : "USA", city: "" } : null,
    job: { ...f.input, title: prior.title, slug: prior.slug, descriptionHtml: prior.descriptionHtml, fields: prior.fields, location: prior.location, status: prior.status, aiMatchEnabled: prior.aiMatchEnabled, ...jobPatch },
  }), MANAGER, f.store);
}
async function evidence(f: Fixture) {
  return {
    rows: await f.store.rows("SELECT application_id,status,score,review_json,warnings_json,updated_at FROM hub_ai_matches WHERE job_id=? AND form_version=? ORDER BY application_id", f.job.id, (await f.store.getJob(f.job.id)).formVersion),
    history: await f.store.rows("SELECT * FROM hub_history ORDER BY application_id,id"),
    applications: await f.store.rows("SELECT id,revision,answers_json,fields_json,stage,qualification FROM hub_applications ORDER BY id"),
  };
}

for (const api of ["hub PATCH", "wizard POST"] as const) {
  test(`${api} preserves completed AI evidence, scores and history after question reorder and location edits without provider calls`, async () => {
    const f = await fixture();
    try {
      const before = await evidence(f), metrics = f.metrics();
      const reordered = [...f.job.fields.filter(field => ["_systemfield_name", "_systemfield_email"].includes(field.path)), ...f.job.fields.filter(field => !["_systemfield_name", "_systemfield_email"].includes(field.path)).reverse()];
      let response = await edit(f, api, f.job, { fields: reordered });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      let current = await f.store.getJob(f.job.id);
      assert.equal(current.formVersion, 2); assert.deepEqual(current.fields, withRequiredApplicationFields(reordered));
      assert.deepEqual(await evidence(f), before);
      response = await edit(f, api, current, { location: "Remote · Spain" });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      current = await f.store.getJob(f.job.id);
      assert.equal(current.formVersion, 3); assert.equal(current.location, "Remote · Spain");
      assert.deepEqual(await evidence(f), before);
      assert.equal((await matchDetail(f.store, f.readyId)).score, 100);
      assert.equal((await matchDetail(f.store, f.needsReviewId)).status, "needs_review");
      await processAiMatches(f.deps);
      assert.deepEqual(f.metrics(), metrics);
      assert.deepEqual(await evidence(f), before);
      assert.equal((await f.store.applications({ jobId: current.id, sort: "ai_match_desc" })).items.find(app => app.id === f.readyId)?.aiMatch?.score, 100);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_criteria WHERE job_id=? AND status='ready'", current.id).first<{ n: number }>())?.n, 3);
    } finally { f.database.close(); }
  });
  test(`${api} changed job requirements invalidate old scores and request new AI analysis`, async () => {
    const f = await fixture();
    try {
      const before = await evidence(f), calls = f.metrics().providerCalls;
      const response = await edit(f, api, f.job, { descriptionHtml: "<p>Build React applications and maintain tested production websites with newly required API security experience.</p>" });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      assert.equal((await matchDetail(f.store, f.readyId)).score, null);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE form_version=2").first<{ n: number }>())?.n, 0);
      assert.deepEqual((await evidence(f)).history, before.history);
      await processAiMatches(f.deps); // new requirement derivation
      assert.equal(f.metrics().providerCalls, calls + 1);
      await processAiMatches(f.deps); // only readable resume needs a new provider call
      assert.equal(f.metrics().providerCalls, calls + 2);
      assert.equal((await matchDetail(f.store, f.readyId)).status, "ready");
      assert.equal((await matchDetail(f.store, f.needsReviewId)).status, "needs_review");
      assert.equal((await f.store.rows("SELECT * FROM hub_ai_matches WHERE form_version=1")).length, 2);
    } finally { f.database.close(); }
  });
  test(`${api} concurrent saves copy evidence only for the winning job version and stale edits have no side effects`, async () => {
    const f = await fixture();
    try {
      const before = await evidence(f), metrics = f.metrics();
      const outcomes = await Promise.all([edit(f, api, f.job, { location: "Remote · Spain" }), edit(f, api, f.job, { location: "Remote · USA" })]);
      assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 409]);
      assert.equal((await f.store.getJob(f.job.id)).formVersion, 2);
      assert.deepEqual(await evidence(f), before);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE form_version=2").first<{ n: number }>())?.n, 2);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE form_version=3").first<{ n: number }>())?.n, 0);
      assert.equal((await edit(f, api, f.job, { descriptionHtml: "<p>Stale manager edits must not change the winning requirements.</p>" })).status, 409);
      await processAiMatches(f.deps); assert.deepEqual(f.metrics(), metrics);
      assert.deepEqual(await evidence(f), before);
    } finally { f.database.close(); }
  });
  test(`${api} a job revision won immediately before its transaction never copies stale evidence into the winner`, async () => {
    const f = await fixture();
    try {
      const history = (await evidence(f)).history;
      const original = f.store.db.batch.bind(f.store.db);
      f.store.db.batch = async statements => {
        f.store.db.batch = original;
        f.database.prepare("UPDATE hub_jobs SET form_version=form_version+1,description_html='<p>Concurrent requirements won this edit.</p>' WHERE id=?").run(f.job.id);
        return original(statements);
      };
      const response = await edit(f, api, f.job, { location: "Remote · Spain" });
      assert.equal(response.status, 409);
      assert.equal((await f.store.getJob(f.job.id)).formVersion, 2);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE form_version=2").first<{ n: number }>())?.n, 0);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_criteria WHERE form_version=2").first<{ n: number }>())?.n, 0);
      assert.deepEqual((await evidence(f)).history, history);
      assert.equal((await f.store.rows("SELECT * FROM hub_settings WHERE key LIKE 'job_save_%'")).length, 0);
    } finally { f.database.close(); }
  });
}
test("wizard scorecard or setup catalog race aborts job edit, ledger and AI evidence copies atomically", async () => {
  for (const key of ["job_setup_v1", "scorecard_templates_v1"]) {
    const f = await fixture();
    try {
      const before = await evidence(f), metrics = f.metrics();
      const original = f.store.db.batch.bind(f.store.db);
      f.store.db.batch = async statements => {
        f.store.db.batch = original;
        await f.store.setSetting(key, key === "job_setup_v1" ? { revision: 1, templates: [], requests: [], locations: {} } : { revision: 1, templates: [], archived: [], bindings: {} });
        return original(statements);
      };
      const response = await edit(f, "wizard POST", f.job, { location: "Remote · Spain" });
      assert.equal(response.status, 409);
      assert.equal((await f.store.getJob(f.job.id)).formVersion, 1);
      assert.deepEqual(await evidence(f), before);
      assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE form_version=2").first<{ n: number }>())?.n, 0);
      assert.equal((await f.store.rows("SELECT * FROM hub_settings WHERE key LIKE 'job_save_%'")).length, 0);
      await processAiMatches(f.deps); assert.deepEqual(f.metrics(), metrics);
    } finally { f.database.close(); }
  }
});
test("current applicant summaries distinguish active running leases, expired leases and requirement preparation", async () => {
  const f = await fixture();
  try {
    const summary = async () => (await f.store.applications({ jobId: f.job.id })).items.find(app => app.id === f.readyId)!.aiMatch!;
    await f.store.stmt("UPDATE hub_ai_matches SET status='running',score=NULL,lease_token='current-worker',lease_until=? WHERE application_id=?", Date.now() + 180_000, f.readyId).run();
    assert.equal((await summary()).status, "running");
    await f.store.stmt("UPDATE hub_ai_matches SET lease_until=? WHERE application_id=?", Date.now() - 1, f.readyId).run();
    assert.equal((await summary()).status, "pending");
    await f.store.stmt("UPDATE hub_ai_matches SET status='pending',lease_token=NULL,lease_until=NULL WHERE application_id=?", f.readyId).run();
    await f.store.stmt("UPDATE hub_ai_criteria SET status='running' WHERE job_id=? AND form_version=?", f.job.id, f.job.formVersion).run();
    assert.equal((await summary()).status, "preparing");
    assert.equal((await summary()).score, null);
  } finally { f.database.close(); }
});
test("failed applicant or requirement summaries keep polling only while the bounded retry budget remains", async () => {
  const f = await fixture();
  try {
    const summary = async () => (await f.store.applications({ jobId: f.job.id })).items.find(app => app.id === f.readyId)!.aiMatch!;
    await f.store.stmt("UPDATE hub_ai_matches SET status='failed',score=NULL,attempts=1,error='ai_request_timeout',run_after=? WHERE application_id=?", Date.now() + 60_000, f.readyId).run();
    assert.equal((await summary()).status, "failed"); assert.equal((await summary()).retryPending, true);
    await f.store.stmt("UPDATE hub_ai_matches SET attempts=5 WHERE application_id=?", f.readyId).run();
    assert.equal((await summary()).retryPending, false);
    await f.store.stmt("UPDATE hub_ai_matches SET status='pending',attempts=0 WHERE application_id=?", f.readyId).run();
    await f.store.stmt("UPDATE hub_ai_criteria SET status='failed',attempts=1,error='ai_request_timeout' WHERE job_id=? AND form_version=?", f.job.id, f.job.formVersion).run();
    assert.equal((await summary()).status, "failed"); assert.equal((await summary()).retryPending, true);
    await f.store.stmt("UPDATE hub_ai_criteria SET attempts=5 WHERE job_id=? AND form_version=?", f.job.id, f.job.formVersion).run();
    assert.equal((await summary()).retryPending, false);
    assert.equal((await summary()).score, null);
  } finally { f.database.close(); }
});
