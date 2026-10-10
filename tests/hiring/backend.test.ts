import assert from "node:assert/strict";
import { test } from "node:test";
import { AshbyClient, normalizeForm, publicJob } from "../../lib/hiring/ashby";
import { sha256 } from "../../lib/hiring/crypto";
import { HiringError, UncertainSubmissionError } from "../../lib/hiring/errors";
import { getJob, getJobs, getReceipt, postApplication, postUpload } from "../../lib/hiring/http";
import { HiringService } from "../../lib/hiring/service";
import { parseApplication, parseUpload, validateAnswers } from "../../lib/hiring/validation";
import { applicationInput, definition, FixtureProvider, JOB_ID, SESSION, sqliteStore } from "./fixtures";

const request = (body: unknown, extra: Record<string, string> = {}) => new Request("https://jobs.example.invalid/api/applications", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://jobs.example.invalid", Cookie: `hiring_session=${SESSION}`, ...extra }, body: JSON.stringify(body) });
const upload = { jobPostingId: JOB_ID, fieldPath: "_systemfield_resume", filename: "resume.pdf", contentType: "application/pdf", contentLength: 128 };

test("preview jobs clearly disable applications and never accept synthetic confirmation links", async () => {
  const deps = { applicationsEnabled: false };
  const response = await getJobs(new Request("https://jobs.example.invalid/api/jobs"), deps);
  const body = await response.json() as { mode: string; submissionEnabled: boolean; jobs: unknown[] };
  assert.equal(body.mode, "preview"); assert.equal(body.submissionEnabled, false); assert.equal(body.jobs.length, 2);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly.*SameSite=Strict.*Secure/);
  const detail = await (await getJob(new Request("https://jobs.example.invalid/api/jobs/full-stack-engineer"), "full-stack-engineer", deps)).json() as { submissionEnabled: boolean };
  assert.equal(detail.submissionEnabled, false);
  assert.equal((await postApplication(request(applicationInput()), deps)).status, 503);
  assert.equal((await getReceipt("a".repeat(64), deps)).status, 404);
});
test("server validates original required fields, options, duplicate paths, and unknown fields", () => {
  const input = applicationInput();
  validateAnswers(input, definition.fields); // false satisfies a required Boolean field.
  assert.throws(() => validateAnswers({ ...input, fieldSubmissions: input.fieldSubmissions.filter(f => f.path !== "_systemfield_email") }, definition.fields), { code: "invalid_application" });
  assert.throws(() => validateAnswers({ ...input, fieldSubmissions: [...input.fieldSubmissions, { path: "admin", value: true }] }, definition.fields), { code: "invalid_request" });
  assert.throws(() => validateAnswers({ ...input, fieldSubmissions: input.fieldSubmissions.map(f => f.path === "specialty" ? { ...f, value: "other" } : f) }, definition.fields), { code: "invalid_application" });
  assert.throws(() => parseApplication({ ...input, fieldSubmissions: [...input.fieldSubmissions, input.fieldSubmissions[0]] }), { code: "invalid_request" });
  assert.throws(() => validateAnswers({ ...input, fieldSubmissions: [{ path: "day", value: "2026-99-01" }] }, [{ path: "day", title: "Date", type: "Date", required: true }]), { code: "invalid_application" });
});
test("upload metadata rejects unsafe paths, MIME mismatches, zero bytes, and oversize files", () => {
  assert.deepEqual(parseUpload(upload), upload);
  for (const change of [{ filename: "../resume.pdf" }, { filename: "payload.html", contentType: "text/html" }, { contentLength: 0 }, { contentLength: 10485761 }, { filename: "resume.pdf", contentType: "image/png" }]) assert.throws(() => parseUpload({ ...upload, ...change }), { code: "invalid_request" });
});
test("published/listed status and application deadlines gate public jobs; provider markup is escaped", () => {
  const base = { id: JOB_ID, title: "Role", status: "Published", isListed: true, descriptionPlain: '<script>alert("fixture")</script>' };
  assert.match(publicJob(base)!.descriptionHtml, /&lt;script&gt;/);
  assert.equal(publicJob({ ...base, status: "Draft" }), null);
  assert.equal(publicJob({ ...base, isListed: false }), null);
  assert.equal(publicJob({ ...base, applicationDeadline: "2020-01-01" }), null);
});
test("configured section forms normalize current documented fields and safely disable unsupported conditional forms", () => {
  const entry = { isRequired: true, field: { path: "test", title: "Test", type: "String" } };
  const form = normalizeForm({ sections: [{ fields: [entry] }] });
  assert.equal(form.fields[0].required, true); assert.equal(form.formUnavailable, undefined);
  assert.ok(normalizeForm({ sections: [{ fields: [{ ...entry, visibilityCondition: { type: "unknown" } }] }] }).formUnavailable);
});
test("closed jobs and unknown upload fields never create handles or submit applications", async () => {
  const { database, store } = sqliteStore(); const provider = new FixtureProvider(); provider.jobs = [];
  const service = new HiringService(provider, store, true);
  await assert.rejects(service.submit(applicationInput(), SESSION), { code: "job_closed" });
  await assert.rejects(service.upload(upload, SESSION), { code: "job_closed" });
  assert.equal(provider.submitCalls, 0); assert.equal(provider.uploadCalls, 0); database.close();
});
test("100 concurrent duplicate submissions have one upstream write and receipts verify only confirmed acceptance", async () => {
  const { database, store } = sqliteStore(); const provider = new FixtureProvider();
  const service = new HiringService(provider, store, true); const input = applicationInput();
  const results = await Promise.all(Array.from({ length: 100 }, () => service.submit(input, SESSION)));
  assert.equal(provider.submitCalls, 1);
  assert.ok(results.some(r => r.status === "accepted"));
  const accepted = results.find(r => r.status === "accepted")!;
  assert.equal((await store.receipt(await sha256(accepted.receipt!)))!.status, "accepted");
  const response = await getReceipt(accepted.receipt!, { store, applicationsEnabled: false });
  assert.equal((await response.json() as { jobTitle: string }).jobTitle, definition.job.title);
  assert.equal((await getReceipt("b".repeat(64), { store, applicationsEnabled: true })).status, 404);
  const replay = await service.submit(input, SESSION);
  assert.equal(replay.status, "accepted"); assert.ok(replay.receipt); assert.equal(provider.submitCalls, 1);
  assert.equal((await store.receipt(await sha256(accepted.receipt!)))!.status, "accepted"); // New receipts don't invalidate old confirmations.
  await assert.rejects(service.submit(input, "b".repeat(64)), { code: "submission_conflict" });
  await assert.rejects(service.submit({ ...input, utmData: { utm_source: "changed" } }, SESSION), { code: "submission_conflict" });
  database.close();
});
test("uncertain writes remain pending and are never retried; definite provider rejections stay failed", async () => {
  const { database, store } = sqliteStore(); const provider = new FixtureProvider(); const service = new HiringService(provider, store, true);
  provider.failure = new UncertainSubmissionError(); const input = applicationInput();
  assert.equal((await service.submit(input, SESSION)).status, "pending");
  assert.equal((await service.submit(input, SESSION)).status, "pending");
  assert.equal(provider.submitCalls, 1);
  provider.failure = new HiringError("provider_validation", 422, "Fixture rejection"); const rejected = applicationInput();
  await assert.rejects(service.submit(rejected, SESSION), { code: "provider_validation" });
  await assert.rejects(service.submit(rejected, SESSION), { code: "submission_failed" });
  assert.equal(provider.submitCalls, 2); database.close();
});
test("uploads are tied to session, field, job, and expiry", async () => {
  const { database, store } = sqliteStore(); const provider = new FixtureProvider(); const service = new HiringService(provider, store, true);
  const handle = await service.upload(upload, SESSION);
  const input = applicationInput(); input.fieldSubmissions.push({ path: upload.fieldPath, value: handle.handle });
  await assert.rejects(service.submit(input, "b".repeat(64)), { code: "invalid_upload" });
  const other = { ...input, submissionKey: crypto.randomUUID() };
  database.prepare("UPDATE hiring_uploads SET expires_at = 0").run();
  await assert.rejects(service.submit(other, SESSION), { code: "invalid_upload" });
  assert.equal(provider.submitCalls, 0); database.close();
});
test("Drive failure cannot turn confirmed acceptance into a failed application", async () => {
  const { database, store } = sqliteStore(); const provider = new FixtureProvider();
  const service = new HiringService(provider, store, true, async () => { throw new Error("Synthetic Drive outage"); });
  const result = await service.submit(applicationInput(), SESSION);
  assert.equal(result.status, "accepted"); assert.equal((await store.receipt(await sha256(result.receipt!)))!.status, "accepted"); database.close();
});
test("request origin, content type, session, and persistent throttles gate public write routes", async () => {
  const { database, store } = sqliteStore(); const provider = new FixtureProvider(); const deps = { provider, store, applicationsEnabled: true };
  assert.equal((await postApplication(request(applicationInput(), { Origin: "https://evil.example.invalid" }), deps)).status, 403);
  assert.equal((await postApplication(request(applicationInput(), { "Content-Type": "text/plain" }), deps)).status, 415);
  assert.equal((await postApplication(request(applicationInput(), { Cookie: "" }), deps)).status, 409);
  assert.equal((await postUpload(request(upload, { Origin: "https://evil.example.invalid" }), deps)).status, 403);
  const counts = await Promise.all(Array.from({ length: 100 }, () => store.takeRateLimit("test", 1, 10)));
  assert.equal(counts.filter(Boolean).length, 10);
  assert.equal(provider.submitCalls, 0); database.close();
});
test("Ashby client uses Basic auth, listedOnly, JSON signed uploads, explicit published submission, and current success envelope", async () => {
  const calls: { endpoint: string; body: Record<string, unknown> }[] = [];
  const client = new AshbyClient("fixture-secret", async (url, init) => {
    const endpoint = String(url).split("/").at(-1)!; const body = JSON.parse(String(init!.body)); calls.push({ endpoint, body });
    assert.equal(new Headers(init!.headers).get("Authorization"), `Basic ${btoa("fixture-secret:")}`);
    let results: unknown = [];
    if (endpoint === "applicationForm.submit") results = { submittedFormInstance: { id: "fixture-instance" }, formMessages: { blocked: false } };
    return Response.json({ success: true, results });
  });
  await client.listJobs(); const outcome = await client.submit(applicationInput());
  assert.equal(outcome.submittedFormInstanceId, "fixture-instance"); assert.equal(calls[0].body.listedOnly, true);
  assert.equal(calls[1].body.allowSubmissionForUnpublishedJobPosting, false);
  assert.equal("submissionKey" in calls[1].body, false);
});
test("HTTP 200 unsuccessful, blocked, malformed, and network-timeout responses cannot be mistaken for acceptance", async () => {
  const fail = new AshbyClient("fixture", async () => Response.json({ success: false, errorInfo: { message: "sensitive provider detail" } }));
  await assert.rejects(fail.submit(applicationInput()), { code: "provider_validation" });
  const blocked = new AshbyClient("fixture", async () => Response.json({ success: true, results: { formMessages: { blocked: true } } }));
  assert.equal((await blocked.submit(applicationInput())).blocked, true);
  const malformed = new AshbyClient("fixture", async () => Response.json({ success: true, results: {} }));
  await assert.rejects(malformed.submit(applicationInput()), { code: "submission_pending" });
  let calls = 0;
  const timeout = new AshbyClient("fixture", async () => { calls++; throw new Error("Synthetic timeout"); });
  await assert.rejects(timeout.submit(applicationInput()), { code: "submission_pending" }); assert.equal(calls, 1);
});
