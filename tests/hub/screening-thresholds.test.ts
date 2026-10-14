import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationInput, createStore, jobInput } from "./fixtures";

function definition() {
  const job = jobInput();
  job.fields.find((field) => field.path === "experience")!.required = true;
  job.fields.push({ path: "briefs", title: "Briefs completed", type: "Number", required: true }, { path: "available", title: "Available for the schedule", type: "Boolean", required: true });
  job.rules = [
    { fieldPath: "experience", operator: "gte", value: 7, reason: "At least seven years", enabled: true },
    { fieldPath: "briefs", operator: "gte", value: 0, reason: "Non-negative brief count", enabled: true },
    { fieldPath: "available", operator: "equals", value: false, reason: "Approved No answer", enabled: true },
  ];
  job.autoReject = true;
  return job;
}
function input(jobId: string, years: number, available: boolean) {
  const app = applicationInput(jobId);
  app.fieldSubmissions.find((field) => field.path === "experience")!.value = years;
  app.fieldSubmissions.push({ path: "briefs", value: 0 }, { path: "available", value: available });
  return app;
}

test("numeric minimum is inclusive; zero and Boolean false are real answers, not missing", async () => {
  const { store, database } = createStore();
  try {
    const job = await store.saveJob(definition());
    for (const [years, available, qualification] of [[6, false, "fail"], [7, false, "pass"], [8, false, "pass"], [7, true, "fail"]] as const) {
      const { id } = await store.acceptApplication(input(job.id, years, available));
      const detail = await store.getApplication(id);
      assert.equal(detail.qualification, qualification);
      assert.equal(detail.stage, qualification === "fail" ? "Rejected" : "Application Review");
      assert.equal(detail.communications.filter((mail) => mail.subject === "Your application to AI Case Leads").length, qualification === "fail" ? 1 : 0);
    }
  } finally { database.close(); }
});

test("missing required answers block submission; optional missing rule answers go to review", async () => {
  const { store, database } = createStore();
  try {
    const config = definition();
    const job = await store.saveJob(config);
    const app = input(job.id, 6, false);
    app.fieldSubmissions = app.fieldSubmissions.filter((field) => field.path !== "available");
    await assert.rejects(store.acceptApplication(app), { code: "invalid_application" });
    config.fields.find((field) => field.path === "available")!.required = false;
    await store.saveJob(config, job.id, job.formVersion);
    const { id } = await store.acceptApplication(app);
    const detail = await store.getApplication(id);
    assert.equal(detail.qualification, "review");
    assert.equal(detail.stage, "Application Review");
    assert.equal(detail.communications.filter((mail) => mail.subject === "Your application to AI Case Leads").length, 0);
  } finally { database.close(); }
});

test("retries queue one rejection and later rule changes preserve the original decision", async () => {
  const { store, database } = createStore();
  try {
    const config = definition();
    const job = await store.saveJob(config);
    const app = input(job.id, 6, false);
    app.formVersion = job.formVersion;
    const results = await Promise.all(Array.from({ length: 10 }, () => store.acceptApplication(app)));
    assert.equal(new Set(results.map((result) => result.id)).size, 1);
    config.rules[0].value = 5;
    const changed = await store.saveJob(config, job.id, job.formVersion);
    const retry = await store.acceptApplication(app);
    const detail = await store.getApplication(retry.id);
    assert.equal(detail.stage, "Rejected");
    assert.equal(detail.qualificationEvidence[0].matched, false);
    assert.equal(detail.communications.filter((mail) => mail.subject === "Your application to AI Case Leads").length, 1);
    const stale = input(job.id, 6, false);
    stale.formVersion = job.formVersion;
    await assert.rejects(store.acceptApplication(stale));
    stale.formVersion = changed.formVersion;
    const accepted = await store.acceptApplication(stale);
    assert.equal((await store.getApplication(accepted.id)).qualification, "pass");
  } finally { database.close(); }
});

test("Yes requirement fails on No, while disabling automatic rejection keeps human review", async () => {
  const { store, database } = createStore();
  try {
    const config = definition();
    config.rules[2].value = true;
    const job = await store.saveJob(config);
    const no = await store.acceptApplication(input(job.id, 7, false));
    assert.equal((await store.getApplication(no.id)).stage, "Rejected");
    const yes = await store.acceptApplication(input(job.id, 7, true));
    assert.equal((await store.getApplication(yes.id)).qualification, "pass");
    config.autoReject = false;
    await store.saveJob(config, job.id, job.formVersion);
    const human = await store.acceptApplication(input(job.id, 6, false));
    const detail = await store.getApplication(human.id);
    assert.equal(detail.qualification, "fail");
    assert.equal(detail.stage, "Application Review");
    assert.equal(detail.communications.filter((mail) => mail.subject === "Your application to AI Case Leads").length, 0);
  } finally { database.close(); }
});
