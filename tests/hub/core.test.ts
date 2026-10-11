import { currentAction, currentBulk } from "./fixtures";
import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationIdForSubmissionKey } from "../../lib/hub/store";
import { evaluateRequirements } from "../../lib/hub/validation";
import { sha256 } from "../../lib/hiring/crypto";
import { handleHubRequest } from "../../lib/hub/http";
import {
  createStore,
  MANAGER,
  RECRUITER,
  SESSION_HASH,
  jobInput,
  applicationInput,
} from "./fixtures";

test("setup seeds exactly two drafts with no invented requirements, and public listing excludes drafts", async () => {
  const { store, database } = createStore();
  const jobs = await store.seedDraftJobs();
  assert.deepEqual(
    jobs.map((j) => j.title),
    ["Full-stack Engineer", "Creative Strategist"],
  );
  assert.ok(
    jobs.every(
      (j) =>
        j.status === "draft" &&
        !j.fields.length &&
        !j.rules.length &&
        !j.autoReject,
    ),
  );
  await store.seedDraftJobs();
  assert.equal((await store.listJobs()).length, 2);
  assert.deepEqual(await store.listPublishedJobs(), []);
  database.close();
});
test("atomic local application snapshots answers/files/tracking/outbox and deduplicates concurrent submissions", async () => {
  const { store, db, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const input = applicationInput(posting.id),
    rawHandle = "b".repeat(64),
    fileId = await sha256(rawHandle),
    now = Date.now();
  await store
    .stmt(
      "INSERT INTO hub_files (id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES (?,?,?,'resume.pdf','application/pdf',5,?,?,?,?)",
      fileId,
      posting.id,
      "_systemfield_resume",
      `fixture/${fileId}`,
      now,
      now + 60000,
      SESSION_HASH,
    )
    .run();
  input.fieldSubmissions.push({
    path: "_systemfield_resume",
    value: rawHandle,
  });
  const id = await applicationIdForSubmissionKey(input.submissionKey);
  const tracking = db
    .prepare(
      "INSERT INTO hiring_submissions (key_hash,session_hash,fingerprint,job_posting_id,job_title,status,application_id,created_at,updated_at) VALUES (?,?,?,?,?,'accepted',?,?,?) ON CONFLICT(key_hash) DO NOTHING",
    )
    .bind(
      await sha256(input.submissionKey),
      SESSION_HASH,
      "fixture-fingerprint",
      posting.id,
      posting.title,
      id,
      now,
      now,
    );
  const accepted = await store.acceptApplication(input, SESSION_HASH, [
    tracking,
  ]);
  assert.equal(accepted.id, id);
  const detail = await store.getApplication(id);
  assert.equal(detail.files.length, 1);
  assert.equal(
    detail.answers.find((a) => a.path === "_systemfield_resume")!.value,
    fileId,
  );
  assert.equal(detail.stage, "Application Review");
  assert.equal(detail.qualification, "review");
  assert.equal((await store.tasks()).length, 2);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hiring_submissions").get()!.n,
    1,
  );
  await Promise.all(
    Array.from({ length: 100 }, () => store.acceptApplication(input)),
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()!.n,
    1,
  );
  assert.equal((await store.tasks()).length, 2);
  assert.equal(detail.files[0].url, `/api/files/${fileId}`);
  database.close();
});
test("file claiming rejects incomplete uploads, ownership mismatch, and wrong field/job", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const input = applicationInput(posting.id),
    raw = "b".repeat(64),
    id = await sha256(raw),
    now = Date.now();
  await store
    .stmt(
      "INSERT INTO hub_files (id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES (?,?,?,'resume.pdf','application/pdf',5,?,-1,?,?)",
      id,
      posting.id,
      "_systemfield_resume",
      `fixture/${id}`,
      now + 60000,
      SESSION_HASH,
    )
    .run();
  input.fieldSubmissions.push({ path: "_systemfield_resume", value: raw });
  await assert.rejects(store.acceptApplication(input), {
    code: "invalid_upload",
  });
  database.prepare("UPDATE hub_files SET uploaded_at=?").run(now);
  await assert.rejects(store.acceptApplication(input, "c".repeat(64)), {
    code: "invalid_upload",
  });
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()!.n,
    0,
  );
  database.close();
});
test("local acceptance rollback covers supplied tracking failure and no phantom application/outbox remains", async () => {
  const { store, db, database } = createStore();
  const posting = await store.saveJob(jobInput());
  await assert.rejects(
    store.acceptApplication(applicationInput(posting.id), SESSION_HASH, [
      db.prepare(
        "INSERT INTO hub_members (id,email,role,active,created_at,updated_at) VALUES (NULL,'fixture','admin',1,1,1)",
      ),
    ]),
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()!.n,
    0,
  );
  assert.equal((await store.tasks()).length, 0);
  database.close();
});
test("approved requirements separate qualification from acceptance and one rejection email is queued", async () => {
  const { store, database } = createStore();
  const definition = jobInput();
  definition.rules = [
    {
      fieldPath: "experience",
      operator: "gte",
      value: 8,
      reason: "Required experience not met",
      enabled: true,
    },
  ];
  definition.autoReject = true;
  const posting = await store.saveJob(definition);
  const result = await store.acceptApplication(applicationInput(posting.id));
  const detail = await store.getApplication(result.id);
  assert.equal(detail.qualification, "fail");
  assert.equal(detail.stage, "Rejected");
  assert.equal(detail.qualificationEvidence[0].matched, false);
  assert.equal(
    detail.communications.filter(
      (c) => c.subject === "Your application to AI Case Leads",
    ).length,
    1,
  );
  await currentAction(store,
    result.id,
    { action: "reject", reason: "Repeat click" },
    MANAGER,
  );
  assert.equal(
    (await store.getApplication(result.id)).communications.filter(
      (c) => c.subject === "Your application to AI Case Leads",
    ).length,
    1,
  );
  const incomplete = applicationInput(posting.id);
  incomplete.fieldSubmissions = incomplete.fieldSubmissions.filter(
    (f) => f.path !== "experience",
  );
  const review = await store.acceptApplication(incomplete);
  assert.equal((await store.getApplication(review.id)).qualification, "review");
  assert.equal(
    (await store.getApplication(review.id)).stage,
    "Application Review",
  );
  database.close();
});
test("requirement operators use explicit expected values and missing data needs human review", () => {
  const fields = jobInput().fields;
  const rules = [
    {
      fieldPath: "experience",
      operator: "gte" as const,
      value: 5,
      reason: "Five years required",
      enabled: true,
    },
  ];
  assert.equal(
    evaluateRequirements(rules, [{ path: "experience", value: 5 }], fields)
      .qualification,
    "pass",
  );
  assert.equal(
    evaluateRequirements(rules, [{ path: "experience", value: 3 }], fields)
      .qualification,
    "fail",
  );
  assert.equal(evaluateRequirements(rules, [], fields).qualification, "review");
});
test("stage changes do not invite candidates; notes, assignment, scorecards, and reporting persist", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await currentAction(store, id, { action: "stage", stage: "Interview" }, RECRUITER);
  assert.equal((await store.getApplication(id)).interview, undefined);
  await currentAction(store,
    id,
    { action: "note", text: "Evidence-backed review" },
    RECRUITER,
  );
  await currentAction(store,
    id,
    { action: "assign", assignee: RECRUITER.email },
    RECRUITER,
  );
  await currentAction(store,
    id,
    {
      action: "scorecard",
      score: 4,
      criteria: "Role-specific work sample",
      text: "Clear tradeoffs",
    },
    RECRUITER,
  );
  const detail = await store.getApplication(id);
  assert.equal(detail.notes.length, 1);
  assert.equal(detail.assignee, RECRUITER.email);
  assert.equal(detail.scorecards[0].score, 4);
  assert.ok(detail.history.some((h) => h.actor === RECRUITER.email));
  const report = await store.reports();
  assert.equal(report.applications, 1);
  assert.equal(report.sources[0].source, "synthetic-test");
  assert.equal(report.workload[0].assignee, RECRUITER.email);
  assert.equal(
    report.conversion.find((s) => s.stage === "Interview")!.count,
    1,
  );
  database.close();
});
test("bulk actions are all-or-nothing and private settings exclude sealed OAuth values", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await assert.rejects(
    currentBulk(store, [id, "missing"], { action: "stage", stage: "Offer" }, MANAGER),
    { code: "application_not_found" },
  );
  assert.equal((await store.getApplication(id)).stage, "Application Review");
  await store.setSetting("google_refresh_token", "sealed-private-test");
  assert.ok(
    !JSON.stringify(await store.settings()).includes("sealed-private-test"),
  );
  database.close();
});
test("staff configuration requires manager access and writes require origin/JSON", async () => {
  const { store, database } = createStore();
  const request = (
    method: string,
    body: unknown = {},
    origin = "https://jobs.example.invalid",
  ) =>
    new Request("https://jobs.example.invalid/api/hub/jobs", {
      method,
      headers: { Origin: origin, "Content-Type": "application/json" },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (
      await handleHubRequest(
        request("POST", jobInput()),
        ["jobs"],
        RECRUITER,
        store,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleHubRequest(
        request("POST", jobInput(), "https://evil.example.invalid"),
        ["jobs"],
        MANAGER,
        store,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleHubRequest(
        request("POST", jobInput()),
        ["jobs"],
        MANAGER,
        store,
      )
    ).status,
    200,
  );
  const rules = jobInput();
  rules.autoReject = true;
  await assert.rejects(store.saveJob(rules), { code: "invalid_rule" });
  database.close();
});

test("screening requirement types cannot silently disqualify valid values", async () => {
  const { store, database } = createStore();
  for (const rule of [
    {
      fieldPath: "experience",
      operator: "equals" as const,
      value: "5",
      reason: "Invalid numeric type",
      enabled: true,
    },
    {
      fieldPath: "_systemfield_name",
      operator: "equals" as const,
      value: 5,
      reason: "Invalid text type",
      enabled: true,
    },
    {
      fieldPath: "experience",
      operator: "contains" as const,
      value: "5",
      reason: "Invalid numeric operator",
      enabled: true,
    },
  ]) {
    const definition = jobInput();
    definition.rules = [rule];
    await assert.rejects(store.saveJob(definition), { code: "invalid_rule" });
  }
  const definition = jobInput();
  definition.fields.push({
    path: "availability",
    title: "Availability",
    type: "ValueSelect",
    required: true,
    options: [{ value: "yes", label: "Yes" }],
  });
  definition.rules = [
    {
      fieldPath: "availability",
      operator: "equals",
      value: "maybe",
      reason: "Unsupported option",
      enabled: true,
    },
  ];
  await assert.rejects(store.saveJob(definition), { code: "invalid_rule" });
  database.close();
});
test("description edits preserve escaped content without enabling scripts or attributes", async () => {
  const { store, database } = createStore();
  const definition = jobInput();
  definition.descriptionHtml =
    '<p onclick="bad()">R&amp;D &lt;script&gt; &quot;quoted&quot;</p><script>bad()</script>';
  const posting = await store.saveJob(definition);
  assert.ok(!posting.descriptionHtml.includes("onclick"));
  assert.ok(!posting.descriptionHtml.includes("<script>"));
  const edited = await store.saveJob(
    {
      ...definition,
      descriptionHtml: posting.descriptionHtml,
      title: "Updated title",
    },
    posting.id,
  );
  assert.equal(edited.descriptionHtml, posting.descriptionHtml);
  const second = await store.saveJob(
    {
      ...definition,
      descriptionHtml: posting.descriptionHtml + "<p>New paragraph</p>",
    },
    posting.id,
  );
  assert.ok(!second.descriptionHtml.includes("&amp;amp;"));
  database.close();
});

test("partial job edits preserve unchanged configuration and reject stale form versions", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const patch = (body: unknown) =>
    new Request(`https://jobs.example.invalid/api/hub/jobs/${posting.id}`, {
      method: "PATCH",
      headers: {
        Origin: "https://jobs.example.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await handleHubRequest(
        patch({
          title: "Updated approved title",
          formVersion: posting.formVersion,
        }),
        ["jobs", posting.id],
        MANAGER,
        store,
      )
    ).status,
    200,
  );
  const updated = await store.getJob(posting.id);
  assert.equal(updated.descriptionHtml, posting.descriptionHtml);
  assert.deepEqual(updated.fields, posting.fields);
  assert.equal(updated.formVersion, posting.formVersion + 1);
  assert.equal(
    (
      await handleHubRequest(
        patch({ title: "Stale overwrite", formVersion: posting.formVersion }),
        ["jobs", posting.id],
        MANAGER,
        store,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await handleHubRequest(
        patch({
          title: "Invalid cast",
          formVersion: String(updated.formVersion),
        }),
        ["jobs", posting.id],
        MANAGER,
        store,
      )
    ).status,
    422,
  );
  assert.equal(
    (await store.getJob(posting.id)).title,
    "Updated approved title",
  );
  database.close();
});

test("task API paging validates its cursor and never exposes invitation payloads or leases", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  await store.acceptApplication(applicationInput(posting.id));
  const get = (page: string) =>
    new Request(`https://jobs.example.invalid/api/hub/tasks?page=${page}`);
  for (const invalid of ["0", "10001", "bad", "-1"])
    assert.equal(
      (await handleHubRequest(get(invalid), ["tasks"], MANAGER, store)).status,
      422,
    );
  const response = await handleHubRequest(get("1"), ["tasks"], MANAGER, store);
  const body = (await response.json()) as { data: Record<string, unknown>[] };
  assert.equal(body.data.length, 2);
  assert.ok(
    body.data.every(
      (t) => t.payload === undefined && t.leaseToken === undefined,
    ),
  );
  assert.deepEqual(
    await (await handleHubRequest(get("2"), ["tasks"], MANAGER, store)).json(),
    { data: [] },
  );
  database.close();
});

test("application form version pins the questions and approved requirements the applicant saw", async () => {
  const { store, database } = createStore();
  const definition = jobInput(),
    posting = await store.saveJob(definition);
  const form = await store.jobDefinition(posting.id);
  assert.equal(form.formVersion, posting.formVersion);
  const input = {
    ...applicationInput(posting.id),
    formVersion: posting.formVersion,
  };
  await store.saveJob(
    {
      ...definition,
      rules: [
        {
          fieldPath: "experience",
          operator: "gte",
          value: 8,
          reason: "Approved requirement changed",
          enabled: true,
        },
      ],
      autoReject: true,
    },
    posting.id,
    posting.formVersion,
  );
  await assert.rejects(store.acceptApplication(input), {
    code: "form_changed",
  });
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()!.n,
    0,
  );
  assert.equal((await store.tasks()).length, 0);
  const current = await store.getJob(posting.id);
  await store.acceptApplication({ ...input, formVersion: current.formVersion });
  assert.equal(
    database.prepare("SELECT form_version FROM hub_applications").get()!
      .form_version,
    current.formVersion,
  );
  database.close();
});

test("manual rejection queues once per decision and a reopened application may receive a later decision", async () => {
  const { store, database } = createStore();
  const posting = await store.saveJob(jobInput());
  const { id } = await store.acceptApplication(applicationInput(posting.id));
  await currentAction(store,
    id,
    { action: "reject", reason: "First explicit decision" },
    MANAGER,
  );
  await currentAction(store,
    id,
    { action: "reject", reason: "Repeated click" },
    MANAGER,
  );
  assert.equal(
    (await store.getApplication(id)).communications.filter(
      (c) => c.subject === "Your application to AI Case Leads",
    ).length,
    1,
  );
  await currentAction(store, id, { action: "stage", stage: "Screening" }, MANAGER);
  await currentAction(store,
    id,
    { action: "reject", reason: "Later explicit decision after reopening" },
    MANAGER,
  );
  assert.equal(
    (await store.getApplication(id)).communications.filter(
      (c) => c.subject === "Your application to AI Case Leads",
    ).length,
    2,
  );
  database.close();
});

test("source quality measures distinct actual stage visits and uses applications as every rate denominator", async () => {
  const { store, database } = createStore(),
    definition = jobInput();
  definition.rules = [
    {
      fieldPath: "experience",
      operator: "gte",
      value: 5,
      reason: "Approved synthetic qualification",
      enabled: true,
    },
  ];
  const posting = await store.saveJob(definition);
  const cohort = async (source: string, experience: number) => {
    const input = applicationInput(posting.id);
    input.utmData = { utm_source: source };
    input.fieldSubmissions = input.fieldSubmissions.map((answer) =>
      answer.path === "experience" ? { ...answer, value: experience } : answer,
    );
    return store.acceptApplication(input);
  };
  const a1 = await cohort("alpha", 5),
    a2 = await cohort("alpha", 8),
    a3 = await cohort("alpha", 1),
    b1 = await cohort("beta", 1),
    b2 = await cohort("beta", 2);
  for (const stage of ["Interview", "Offer", "Interview", "Hired"] as const)
    await currentAction(store, a1.id, { action: "stage", stage }, MANAGER);
  await currentAction(store, a2.id, { action: "stage", stage: "Interview" }, MANAGER);
  await currentAction(store, a3.id, { action: "stage", stage: "Offer" }, MANAGER);
  await currentAction(store, b1.id, { action: "stage", stage: "Hired" }, MANAGER);
  await currentAction(store, b2.id, { action: "stage", stage: "Screening" }, MANAGER);
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM hub_history WHERE application_id=? AND to_stage='Interview'",
      )
      .get(a1.id)!.n,
    2,
  );
  database
    .prepare(
      "DELETE FROM hub_history WHERE application_id=? AND to_stage='Interview'",
    )
    .run(a2.id);
  const report = await store.reports();
  assert.equal(report.applications, 5);
  assert.deepEqual(
    report.sources.find((source) => source.source === "alpha"),
    {
      source: "alpha",
      count: 3,
      qualified: 2,
      interviewed: 2,
      hired: 1,
      qualificationRate: 2 / 3,
      interviewRate: 2 / 3,
      hireRate: 1 / 3,
    },
  );
  assert.deepEqual(
    report.sources.find((source) => source.source === "beta"),
    {
      source: "beta",
      count: 2,
      qualified: 0,
      interviewed: 0,
      hired: 1,
      qualificationRate: 0,
      interviewRate: 0,
      hireRate: 1 / 2,
    },
  );
  database.close();
});

test("reminder opt-in is an explicit boolean manager setting", async () => {
  const { store, database } = createStore();
  const patch = (body: unknown) =>
    new Request("https://jobs.example.invalid/api/hub/settings", {
      method: "PATCH",
      headers: {
        Origin: "https://jobs.example.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await store.settings()).scheduling.remindersEnabled, false);
  assert.equal(
    (
      await handleHubRequest(
        patch({ interviewRemindersEnabled: true, settingsVersion:1 }),
        ["settings"],
        RECRUITER,
        store,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleHubRequest(
        patch({ interviewRemindersEnabled: "true", settingsVersion:1 }),
        ["settings"],
        MANAGER,
        store,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await handleHubRequest(
        patch({ interviewRemindersEnabled: true, settingsVersion:1 }),
        ["settings"],
        MANAGER,
        store,
      )
    ).status,
    200,
  );
  assert.equal((await store.settings()).scheduling.remindersEnabled, true);
  assert.equal(
    (
      await handleHubRequest(
        patch({ interviewRemindersEnabled: false, settingsVersion:2 }),
        ["settings"],
        MANAGER,
        store,
      )
    ).status,
    200,
  );
  assert.equal((await store.settings()).scheduling.remindersEnabled, false);
  database.close();
});

test("archive grouping snapshots survive job edits and reposting keeps separate applications", async () => {
  const {store,database}=createStore();
  const first=await store.saveJob({...jobInput(),archiveProject:"Creative Strategist",archiveCountry:"Spain",hiringRound:"October"});
  const accepted=await store.acceptApplication(applicationInput(first.id),SESSION_HASH);
  await store.saveJob({...first,archiveCountry:"USA",hiringRound:"November"},first.id,first.formVersion);
  const detail=await store.getApplication(accepted.id);
  assert.equal(detail.archiveProject,"Creative Strategist");
  assert.equal(detail.archiveCountry,"Spain");
  assert.equal(detail.hiringRound,"October");
  const next=await store.saveJob({...jobInput(),slug:"next-round",archiveProject:"Creative Strategist",archiveCountry:"Spain",hiringRound:"October"});
  const newer=await store.acceptApplication(applicationInput(next.id),SESSION_HASH);
  assert.notEqual(newer.id,accepted.id);
  assert.notEqual((await store.getApplication(newer.id)).jobId,detail.jobId);
  assert.equal((await store.getApplication(accepted.id)).archiveCountry,"Spain");
  database.close();
});


test("partial job edits retain the posting archive grouping and prior application snapshot", async () => {
  const {store,database}=createStore();
  try {
    const job=await store.saveJob({...jobInput(),archiveProject:"Creative Department",archiveCountry:"Spain",hiringRound:"Approved previous posting"});
    const application=await store.acceptApplication(applicationInput(job.id),SESSION_HASH);
    const response=await handleHubRequest(new Request("https://careers.example.invalid/api/hub/jobs/"+job.id,{method:"PATCH",headers:{"Content-Type":"application/json",Origin:"https://careers.example.invalid"},body:JSON.stringify({status:"closed",formVersion:job.formVersion})}),["jobs",job.id],MANAGER,store);
    assert.equal(response.status,200,await response.clone().text());
    const saved=await store.getJob(job.id);
    assert.equal(saved.archiveProject,job.archiveProject);assert.equal(saved.archiveCountry,job.archiveCountry);assert.equal(saved.hiringRound,job.hiringRound);assert.equal(saved.status,"closed");
    const original=await store.getApplication(application.id);assert.equal(original.jobId,job.id);
    const row=await store.applicationRow(application.id);assert.equal(row.archive_project,"Creative Department");assert.equal(row.hiring_round,"Approved previous posting");
  } finally {database.close();}
});
