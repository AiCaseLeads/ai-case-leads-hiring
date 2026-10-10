import { test } from "node:test";
import assert from "node:assert/strict";
import { AshbyArchiveClient } from "../../lib/archive/ashby";
import { SubmissionRecovery } from "../../lib/hiring/recovery";
import { HiringService } from "../../lib/hiring/service";
import { sha256 } from "../../lib/hiring/crypto";
import { UncertainSubmissionError } from "../../lib/hiring/errors";
import {
  sqliteStore,
  FixtureProvider,
  applicationInput,
  SESSION,
  JOB_ID,
} from "./fixtures";

const id = "7a3d9986-a88a-49f4-b363-8da21b893e31";
const formId = "7a3d9986-a88a-49f4-b363-8da21b893e30";
async function fixture() {
  const { db, database, store } = sqliteStore();
  const provider = new FixtureProvider();
  provider.failure = new UncertainSubmissionError();
  const input = applicationInput();
  assert.equal(
    (await new HiringService(provider, store, true).submit(input, SESSION))
      .status,
    "pending",
  );
  const application = {
    id,
    appliedViaJobPostingId: JOB_ID,
    candidate: { id },
    job: { id },
    applicationFormSubmissions: [
      {
        id: formId,
        submittedValues: Object.fromEntries(
          input.fieldSubmissions.map((f) => [f.path, f.value]),
        ),
      },
    ],
  };
  const archive = new AshbyArchiveClient("isolated-key", async (_url, init) => {
    assert.equal(init?.method, "POST");
    return Response.json({ success: true, results: application });
  });
  const recovery = new SubmissionRecovery(db, archive);
  const resolution = {
    keyHash: await sha256(input.submissionKey),
    applicationId: id,
    submittedFormInstanceId: formId,
    operatorId: crypto.randomUUID(),
    evidenceId: crypto.randomUUID(),
    confirmExactSubmission: true,
    originalPayload: {
      jobPostingId: input.jobPostingId,
      fieldSubmissions: input.fieldSubmissions,
      utmData: input.utmData,
    },
  };
  return { recovery, resolution, application, provider, database };
}
test("operator resolution confirms exact original and provider answers, with immutable audit and no submit replay", async () => {
  const f = await fixture();
  assert.equal((await f.recovery.pending()).length, 1);
  assert.equal((await f.recovery.resolve(f.resolution)).status, "accepted");
  const row = f.database.prepare("SELECT * FROM hiring_submissions").get()!;
  assert.equal(row.resolution_operator_id, f.resolution.operatorId);
  assert.equal(row.resolution_evidence_id, f.resolution.evidenceId);
  assert.equal(
    f.database
      .prepare(
        "SELECT COUNT(*) AS n FROM archive_events WHERE application_id=? AND status='pending'",
      )
      .get(id)?.n,
    1,
  );
  assert.equal(f.provider.submitCalls, 1);
  assert.equal((await f.recovery.pending()).length, 0);
  await assert.rejects(
    () => f.recovery.resolve(f.resolution),
    /pending_submission_not_found/,
  );
  f.database.close();
});
test("recovery refuses guessed matches, wrong posting, missing confirmation and changed original payload", async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      f.recovery.resolve({ ...f.resolution, confirmExactSubmission: false }),
    /confirmation_required/,
  );
  await assert.rejects(
    () =>
      f.recovery.resolve({
        ...f.resolution,
        originalPayload: {
          ...f.resolution.originalPayload,
          utmData: { utm_source: "changed" },
        },
      }),
    /original_payload_mismatch/,
  );
  f.application.appliedViaJobPostingId = id;
  await assert.rejects(
    () => f.recovery.resolve(f.resolution),
    /provider_posting_mismatch/,
  );
  f.application.appliedViaJobPostingId = JOB_ID;
  f.application.applicationFormSubmissions[0].submittedValues._systemfield_name =
    "Different person";
  await assert.rejects(
    () => f.recovery.resolve(f.resolution),
    /provider_answers_mismatch/,
  );
  assert.equal((await f.recovery.pending()).length, 1);
  assert.equal(f.provider.submitCalls, 1);
  f.database.close();
});
test("a submitted form cannot resolve two different local applications", async () => {
  const f = await fixture();
  f.database
    .prepare(
      "INSERT INTO hiring_submissions (key_hash,session_hash,fingerprint,job_posting_id,job_title,status,submitted_form_instance_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "c".repeat(64),
      "d".repeat(64),
      "e".repeat(64),
      JOB_ID,
      "Synthetic",
      "accepted",
      formId,
      1,
      1,
    );
  await assert.rejects(
    () => f.recovery.resolve(f.resolution),
    /resolution_conflict/,
  );
  assert.equal((await f.recovery.pending()).length, 1);
  f.database.close();
});
