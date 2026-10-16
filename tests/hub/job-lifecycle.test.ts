import assert from "node:assert/strict";
import { test } from "node:test";
import { changeJobLifecycle, jobLifecycleKey } from "../../lib/hub/job-lifecycle";
import { handleHubRequest } from "../../lib/hub/http";
import { handleJobSetup } from "../../lib/job-setup/http";
import { applicationInput, createStore, jobInput, MANAGER, RECRUITER, SESSION_HASH } from "./fixtures";

const origin = "https://jobs.example.invalid";
function request(path: string, method: string, input?: unknown, source = origin) {
  return new Request(origin + path, { method, headers: { Origin: source, "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input) });
}
async function action(store: ReturnType<typeof createStore>["store"], id: string, kind: "pause" | "resume" | "archive" | "delete" | "restore") {
  const job = await store.getJob(id);
  return changeJobLifecycle(store, id, { action: kind, formVersion: job.formVersion, lifecycleRevision: job.lifecycle?.revision || 0 }, RECRUITER);
}

test("pause and resume close the public form without invalidating AI evidence or changing applicant records", async () => {
  const { store, database } = createStore();
  const job = await store.saveJob({ ...jobInput(), aiMatchEnabled: true });
  const applicant = await store.acceptApplication(applicationInput(job.id), SESSION_HASH);
  database.prepare("INSERT INTO hub_ai_criteria(job_id,form_version,status,criteria_json,updated_at) VALUES(?,?,'ready','[]',1)").run(job.id, job.formVersion);
  database.prepare("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,review_json,updated_at) VALUES(?,?,?,'ready',88,'{}',1)").run(applicant.id, job.id, job.formVersion);
  const before = await store.getApplication(applicant.id);
  const paused = await action(store, job.id, "pause");
  assert.equal(paused.status, "closed");
  assert.equal(paused.formVersion, job.formVersion);
  assert.deepEqual(await store.listPublishedJobs(), []);
  await assert.rejects(store.jobDefinition(job.id), /no longer accepting/);
  assert.deepEqual(await store.getApplication(applicant.id), before);
  assert.equal(database.prepare("SELECT score FROM hub_ai_matches WHERE application_id=? AND form_version=?").get(applicant.id, paused.formVersion)!.score, 88);
  const resumed = await action(store, job.id, "resume");
  assert.equal(resumed.status, "open");
  assert.equal(resumed.formVersion, job.formVersion);
  assert.equal((await store.listPublishedJobs()).length, 1);
  assert.equal((await store.jobDefinition(job.id)).formVersion, job.formVersion);
  database.close();
});

test("archive and delete are reversible; restoring stays paused and preserves files, queue and applicants", async () => {
  const { store, database } = createStore();
  const job = await store.saveJob(jobInput());
  const accepted = await store.acceptApplication(applicationInput(job.id), SESSION_HASH);
  database.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES('retained-file',?,'_systemfield_resume','resume.pdf','application/pdf',5,'original-file',1,9999999999999,?)").run(job.id, SESSION_HASH);
  const counts = () => ["hub_applications", "hub_files", "hub_tasks"].map(table => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
  const before = await store.getApplication(accepted.id), retained = counts();
  const archived = await action(store, job.id, "archive");
  assert.equal(archived.lifecycle!.state, "archived");
  assert.equal((await store.listJobs())[0].lifecycle!.state, "archived");
  assert.equal(archived.status, "closed");
  await assert.rejects(store.saveJob({ ...jobInput(), slug: job.slug }, job.id), /Restore this job/);
  const deleted = await action(store, job.id, "delete");
  assert.equal(deleted.lifecycle!.state, "deleted");
  assert.deepEqual(await store.listPublishedJobs(), []);
  const restored = await action(store, job.id, "restore");
  assert.equal(restored.lifecycle!.state, "active");
  assert.equal(restored.status, "closed");
  assert.equal(restored.formVersion, job.formVersion);
  assert.equal(restored.lifecycle!.revision, 3);
  assert.deepEqual(await store.getApplication(accepted.id), before);
  assert.deepEqual(counts(), retained);
  database.close();
});

test("same-job concurrent actions have one winner and lifecycle races roll back metadata and status together", async () => {
  const { store, database } = createStore();
  const job = await store.saveJob(jobInput());
  const results = await Promise.allSettled(["pause", "archive"].map(kind => changeJobLifecycle(store, job.id, { action: kind as "pause" | "archive", formVersion: job.formVersion, lifecycleRevision: 0 }, MANAGER)));
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal((await store.getJob(job.id)).lifecycle!.revision, 1);
  assert.equal((await store.getJob(job.id)).status, "closed");
  const current = await store.getJob(job.id), initial = await store.setting(jobLifecycleKey(job.id), null);
  const batch = store.db.batch.bind(store.db);
  store.db.batch = async statements => {
    database.prepare("UPDATE hub_jobs SET form_version=form_version+1 WHERE id=?").run(job.id);
    return batch(statements);
  };
  await assert.rejects(changeJobLifecycle(store, job.id, { action: "delete", formVersion: current.formVersion, lifecycleRevision: 1 }, MANAGER), /Refresh the job list/);
  assert.deepEqual(await store.setting(jobLifecycleKey(job.id), null), initial);
  assert.equal((await store.getJob(job.id)).status, "closed");
  database.close();
});

test("API allows recruiters to manage jobs, rejects unsafe origins, invalid input and direct archived edits", async () => {
  const { store, database } = createStore();
  const job = await store.saveJob(jobInput());
  const payload = { action: "archive", formVersion: job.formVersion, lifecycleRevision: 0 };
  const path = ["jobs", job.id, "lifecycle"];
  assert.equal((await handleHubRequest(request("/api/hub/jobs/x/lifecycle", "POST", payload, "https://attacker.invalid"), path, RECRUITER, store)).status, 403);
  assert.equal((await handleHubRequest(request("/api/hub/jobs/x/lifecycle", "POST", { ...payload, action: "purge" }), path, MANAGER, store)).status, 422);
  assert.equal((await handleHubRequest(request("/api/hub/jobs/x/lifecycle", "POST", payload), path, RECRUITER, store)).status, 200);
  assert.equal((await handleHubRequest(request("/api/hub/jobs/x", "PATCH", { status: "open", formVersion: job.formVersion, lifecycleRevision: 1 }), ["jobs", job.id], RECRUITER, store)).status, 409);
  assert.equal((await handleHubRequest(request("/api/hub/jobs/x/lifecycle", "POST", payload), path, RECRUITER, store)).status, 409);
  const command = { action: "save", creationId: crypto.randomUUID(), jobId: job.id, formVersion: job.formVersion, expectedLifecycleRevision: 1, job: jobInput(), location: null, expectedBinding: null, scorecard: null };
  assert.equal((await handleJobSetup(request("/api/job-setup", "POST", command), RECRUITER, store)).status, 409);
  database.close();
});

test("paused wizard drafts detect lifecycle changes even though AI form version stays unchanged", async () => {
  const { store, database } = createStore();
  const job = await store.saveJob(jobInput());
  await action(store, job.id, "pause");
  const { lifecycle: _, id: __, formVersion: ___, ...definition } = await store.getJob(job.id);
  void _; void __; void ___;
  const command = { action: "save", creationId: crypto.randomUUID(), jobId: job.id, formVersion: job.formVersion, expectedLifecycleRevision: 0, job: { ...definition, status: "open" }, location: null, expectedBinding: null, scorecard: null };
  const stale = await handleJobSetup(request("/api/job-setup", "POST", command), RECRUITER, store);
  assert.equal(stale.status, 409);
  assert.equal((await store.getJob(job.id)).status, "closed");
  const fresh = await handleJobSetup(request("/api/job-setup", "POST", { ...command, creationId: crypto.randomUUID(), expectedLifecycleRevision: 1, job: definition }), RECRUITER, store);
  assert.equal(fresh.status, 200, await fresh.text());
  database.close();
});
