import test from "node:test";
import assert from "node:assert/strict";
import { createStore, applicationInput, jobInput, MANAGER, RECRUITER, currentAction } from "./fixtures";
import { previewMailRecovery, executeMailRecovery, type RecoveryDependencies } from "../../lib/hub/mail-recovery";
import { changeApplicationTrash } from "../../lib/hub/application-lifecycle";
import { handleHubRequest } from "../../lib/hub/http";
import { Gmail } from "../../lib/google/gmail";
import type { GoogleClient } from "../../lib/google/client";
import { fromBase64url } from "../../lib/google/http";
import { candidateMail } from "../../lib/job-team/service";
import { processHubTasks } from "../../lib/task-runner";
import type { GoogleWorkspace } from "../../lib/google/workspace";

const candidateAccount = "recruiter@example.invalid";
const priorAccount = process.env.CANDIDATE_MAIL_ACCOUNT;
test.before(() => { process.env.CANDIDATE_MAIL_ACCOUNT = candidateAccount; });
test.after(() => { if (priorAccount === undefined) delete process.env.CANDIDATE_MAIL_ACCOUNT; else process.env.CANDIDATE_MAIL_ACCOUNT = priorAccount; });
function ready(now?: number): RecoveryDependencies { return { env: { ADMIN_EMAILS: MANAGER.email }, now: now === undefined ? undefined : () => now, resolve: async account => ({ verifyMailSender: async (sender, required) => { assert.equal(account, candidateAccount); assert.equal(required, candidateAccount); assert.ok([candidateAccount, "no-reply@aicaseleads.com"].includes(sender)); } }) }; }
async function fixture(count = 1) {
  const f = createStore();
  f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,'recruiter',1,0,0)").run(RECRUITER.userId, RECRUITER.email);
  const job = await f.store.saveJob(jobInput()), ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await f.store.acceptApplication(applicationInput(job.id))).id);
  f.database.prepare("UPDATE hub_tasks SET status='failed',last_error='candidate_mail_account_connection_required',run_after=?,attempts=0 WHERE kind='gmail'").run(Number.MAX_SAFE_INTEGER);
  f.database.prepare("UPDATE hub_communications SET status='failed'").run();
  const window = { from: Date.now() - 600_000, to: Date.now() + 600_000 };
  return { ...f, job, ids, window };
}
test("bulk recovery previews eligible receipts, preserves no-reply privacy and Message-ID, and repeated execution never requeues", async () => {
  const f = await fixture(6);
  try {
    f.database.prepare("UPDATE hub_tasks SET status='uncertain' WHERE application_id=? AND kind='gmail'").run(f.ids[2]);
    f.database.prepare("UPDATE hub_tasks SET status='done' WHERE application_id=? AND kind='gmail'").run(f.ids[3]);
    f.database.prepare("UPDATE hub_tasks SET status='running' WHERE application_id=? AND kind='gmail'").run(f.ids[4]);
    f.database.prepare("UPDATE hub_communications SET provider_id='delivered-id',thread_id='thread-id',status='sent' WHERE application_id=?").run(f.ids[5]);
    const original = f.database.prepare("SELECT payload_json FROM hub_tasks WHERE application_id=? AND kind='gmail'").get(f.ids[0])!.payload_json;
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(preview.eligible, 2); assert.equal(preview.counts["Application receipt"], 2);
    assert.ok(preview.skipped.some(item => item.reason.includes("uncertain")));
    assert.ok(preview.messages.every(item => item.sender === "no-reply@aicaseleads.com" && item.replyTo.join() === item.sender));
    assert.equal(f.database.prepare("SELECT status FROM hub_tasks WHERE application_id=? AND kind='gmail'").get(f.ids[0])!.status, "failed");
    const plan = { planId: preview.planId, digest: preview.digest };
    assert.deepEqual(await executeMailRecovery(f.store, MANAGER, plan, ready()), { queued: 2, alreadyQueued: false });
    assert.equal(f.database.prepare("SELECT payload_json FROM hub_tasks WHERE application_id=? AND kind='gmail'").get(f.ids[0])!.payload_json, original);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE kind='gmail' AND status='pending'").get()!.n, 2);
    f.database.prepare("UPDATE hub_tasks SET status='done' WHERE application_id=? AND kind='gmail'").run(f.ids[0]);
    assert.deepEqual(await executeMailRecovery(f.store, MANAGER, plan, ready()), { queued: 2, alreadyQueued: true });
    assert.equal(f.database.prepare("SELECT status FROM hub_tasks WHERE application_id=? AND kind='gmail'").get(f.ids[0])!.status, "done");
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_history WHERE type='email_recovery'").get()!.n, 2);
  } finally { f.database.close(); }
});
test("connected grants cannot recover messages when Google refuses alias readiness; revocation between preview and execution is blocked", async () => {
  const f = await fixture();
  try {
    const invalid = { ...ready(), resolve: async () => ({ verifyMailSender: async () => { throw { code: "gmail_sender_alias_not_verified" }; } }) };
    const blocked = await previewMailRecovery(f.store, MANAGER, f.window, invalid);
    assert.equal(blocked.eligible, 0); assert.equal(blocked.planId, null); assert.match(blocked.skipped[0].reason, /not verified/);
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    await assert.rejects(executeMailRecovery(f.store, MANAGER, { planId: preview.planId, digest: preview.digest }, invalid), { code: "mail_not_ready" });
    assert.equal(f.database.prepare("SELECT status FROM hub_tasks WHERE kind='gmail'").get()!.status, "failed");
  } finally { f.database.close(); }
});
test("all records remain failed if one applicant or task changes after preview, including a race in the final transaction", async () => {
  const f = await fixture(2);
  try {
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    f.database.prepare("UPDATE hub_applications SET revision=revision+1 WHERE id=?").run(f.ids[1]);
    await assert.rejects(executeMailRecovery(f.store, MANAGER, { planId: preview.planId, digest: preview.digest }, ready()), { code: "recovery_plan_changed" });
    let changed = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    const originalBatch = f.store.db.batch.bind(f.store.db);
    f.store.db.batch = async statements => { f.store.db.batch = originalBatch; f.database.prepare("UPDATE hub_tasks SET payload_json=json_set(payload_json,'$.subject','Changed') WHERE application_id=? AND kind='gmail'").run(f.ids[1]); return originalBatch(statements); };
    await assert.rejects(executeMailRecovery(f.store, MANAGER, { planId: changed.planId, digest: changed.digest }, ready()), { code: "recovery_plan_changed" });
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE kind='gmail' AND status='pending'").get()!.n, 0);
    changed = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal((await executeMailRecovery(f.store, MANAGER, { planId: changed.planId, digest: changed.digest }, ready())).queued, 2);
  } finally { f.database.close(); }
});
test("recovery is manager-only, same-origin HTTP protected, actor-bound and expires; sent tasks never reset", async () => {
  const f = await fixture();
  try {
    await assert.rejects(previewMailRecovery(f.store, RECRUITER, f.window, ready()), { code: "admin_access_required" });
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    const plan = { planId: preview.planId, digest: preview.digest };
    await assert.rejects(executeMailRecovery(f.store, { ...MANAGER, email: "other@example.invalid" }, plan, ready()), { code: "recovery_plan_unavailable" });
    await assert.rejects(executeMailRecovery(f.store, MANAGER, plan, ready(preview.expiresAt! + 1)), { code: "recovery_plan_expired" });
    const denied = await handleHubRequest(new Request("https://jobs.example.invalid/api/hub/mail-recovery/preview", { method: "POST", headers: { Origin: "https://jobs.example.invalid", "Content-Type": "application/json" }, body: JSON.stringify(f.window) }), ["mail-recovery", "preview"], RECRUITER, f.store);
    assert.equal(denied.status, 403);
    const crossOrigin = await handleHubRequest(new Request("https://jobs.example.invalid/api/hub/mail-recovery/preview", { method: "POST", headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" }, body: JSON.stringify(f.window) }), ["mail-recovery", "preview"], MANAGER, f.store);
    assert.equal(crossOrigin.status, 403);
  } finally { f.database.close(); }
});
test("Trash, stale rejections, missing approved records, unknown messages and staff-address leakage are excluded", async () => {
  const f = await fixture(5);
  try {
    await changeApplicationTrash(f.store, f.ids[0], "trash", (await f.store.applicationRow(f.ids[0])).revision, MANAGER);
    // An incorrectly retained failure must still be blocked by the independent Trash guard.
    f.database.prepare("UPDATE hub_tasks SET status='failed' WHERE application_id=? AND kind='gmail'").run(f.ids[0]);
    f.database.prepare("UPDATE hub_communications SET status='failed' WHERE application_id=?").run(f.ids[0]);
    f.database.prepare("DELETE FROM hub_communications WHERE application_id=?").run(f.ids[1]);
    f.database.prepare("UPDATE hub_tasks SET id=id||':unknown' WHERE application_id=? AND kind='gmail'").run(f.ids[1]);
    f.database.prepare("UPDATE hub_tasks SET payload_json=json_set(payload_json,'$.body','Contact recruiter@example.invalid') WHERE application_id=? AND kind='gmail'").run(f.ids[2]);
    f.database.prepare("DELETE FROM hub_communications WHERE application_id=?").run(f.ids[3]);
    const id = `gmail:${f.ids[4]}:rejection`;
    await f.store.taskStatement(id, f.ids[4], "gmail", { to: "candidate@example.invalid", subject: "Rejection", body: "Rejected", messageId: "reject@jobs.example.invalid" }, Date.now()).run();
    f.database.prepare("UPDATE hub_tasks SET status='failed' WHERE id=?").run(id);
    f.database.prepare("INSERT INTO hub_communications(id,application_id,task_id,subject,body,status,created_at,updated_at) VALUES(?,?,?,'Rejection','Rejected','failed',0,0)").run(id, f.ids[4], id);
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(preview.eligible, 1);
    assert.ok(preview.skipped.some(item => item.reason.includes("Trash")));
    assert.ok(preview.skipped.some(item => item.reason.includes("private staff")));
    assert.ok(preview.skipped.some(item => item.reason.includes("no longer current")));
  } finally { f.database.close(); }
});
test("a 201-message backlog stays bounded and the next preview advances rather than replaying the first batch", async () => {
  const f = await fixture(201);
  try {
    const first = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(first.eligible, 200); assert.equal(first.remaining, 1);
    assert.equal((await executeMailRecovery(f.store, MANAGER, { planId: first.planId, digest: first.digest }, ready())).queued, 200);
    const second = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(second.eligible, 1); assert.equal(second.remaining, 0);
    assert.equal((await executeMailRecovery(f.store, MANAGER, { planId: second.planId, digest: second.digest }, ready())).queued, 1);
  } finally { f.database.close(); }
});
test("actual MIME receipt envelope excludes staff routing and stale queued replyTo/sender fields", async () => {
  const f = await fixture();
  try {
    let emitted = "", writes = 0;
    const client = { request: async (url: string, init?: RequestInit) => {
      if (url.endsWith("/profile")) return Response.json({ emailAddress: candidateAccount });
      if (url.endsWith("/settings/sendAs")) return Response.json({ sendAs: [{ sendAsEmail: "no-reply@aicaseleads.com", verificationStatus: "accepted" }] });
      if (url.includes("/messages?")) return Response.json({ messages: [] });
      if (url.endsWith("/messages/send")) { writes++; emitted = new TextDecoder().decode(fromBase64url(JSON.parse(String(init!.body)).raw)); return Response.json({ id: "sent", threadId: "thread" }); }
      throw new Error("Unexpected provider path");
    } } as unknown as GoogleClient;
    const mail = await candidateMail(f.store, { to: "synthetic@example.invalid", subject: "Application received", body: "Your application was received.", messageId: "receipt@jobs.example.invalid", sender: candidateAccount, replyTo: [candidateAccount] }, [MANAGER.email], { applicationId: f.ids[0] });
    await new Gmail(client, candidateAccount).verifySender("no-reply@aicaseleads.com", candidateAccount); assert.equal(writes, 0);
    await new Gmail(client, candidateAccount).send(mail);
    assert.equal(writes, 1); assert.match(emitted, /^From: no-reply@aicaseleads.com\r\nTo:/); assert.match(emitted, /\r\nReply-To: no-reply@aicaseleads.com\r\n/);
    assert.doesNotMatch(emitted, /(?:^|\r\n)(?:Sender|Cc|Bcc):|recruiter@example.invalid|sales@/i);
  } finally { f.database.close(); }
});
test("reviewed recruiter messages keep their recruiter routing and are not silently converted to no-reply", async () => {
  const f = await fixture();
  try {
    await currentAction(f.store, f.ids[0], { action: "email", subject: "Next steps", body: "Please reply to discuss your interview." }, RECRUITER);
    f.database.prepare("UPDATE hub_tasks SET status='failed' WHERE kind='gmail'").run();
    f.database.prepare("UPDATE hub_communications SET status='failed'").run();
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(preview.eligible, 2);
    assert.equal(preview.messages.find(item => item.kind === "Recruiter message")!.sender, RECRUITER.email);
  } finally { f.database.close(); }
});
test("expired or replaced private invitations are excluded at preview and suppressed again at the send boundary", async () => {
  const f = await fixture();
  try {
    await currentAction(f.store, f.ids[0], { action: "assessment" }, RECRUITER);
    f.database.prepare("UPDATE hub_tasks SET status='failed',last_error='candidate_mail_account_connection_required',run_after=? WHERE kind='gmail'").run(Number.MAX_SAFE_INTEGER);
    f.database.prepare("UPDATE hub_communications SET status='failed'").run();
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(preview.eligible, 2);
    f.database.prepare("UPDATE hub_links SET expires_at=?").run(Date.now() - 1);
    await assert.rejects(executeMailRecovery(f.store, MANAGER, { planId: preview.planId, digest: preview.digest }, ready()), { code: "recovery_plan_changed" });
    const blocked = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(blocked.eligible, 1); assert.ok(blocked.skipped.some(item => item.reason.includes("expired")));
    const invitation = (await f.store.tasks()).find(task => task.id.includes(":assessment:"))!;
    await f.store.retryTask(invitation.id);
    let sends = 0;
    const google = { archiveApplication: async (detail: { revision: number }) => ({ folderId: "folder", folderUrl: "https://drive.google.com/drive/folders/folder", archivedRevision: detail.revision, archiveFormat: "pdf-v2", legacyJsonFileIds: [] }), profile: async () => ({ email: candidateAccount, historyId: "1" }), mailHistory: async () => ({ historyId: "1", messages: [] }), threadMessages: async () => [], reconcileMail: async () => null, sendMail: async () => { sends++; return { id: "sent", threadId: "thread" }; } } as unknown as GoogleWorkspace;
    await processHubTasks(f.store, f.db, {} as R2Bucket, google, 10, [MANAGER.email], async () => google);
    assert.equal(sends, 0);
    assert.equal(f.database.prepare("SELECT status FROM hub_communications WHERE task_id=?").get(invitation.id)!.status, "cancelled");
  } finally { f.database.close(); }
});
test("legacy automatic receipt routing fields cannot turn it into a private recruiter message", async () => {
  const f = await fixture();
  try {
    f.database.prepare("UPDATE hub_tasks SET payload_json=json_set(payload_json,'$.mailMode','recruiter','$.actor',?,'$.sender',?,'$.replyTo',json(?)) WHERE kind='gmail'").run(RECRUITER.email, RECRUITER.email, JSON.stringify([RECRUITER.email]));
    const preview = await previewMailRecovery(f.store, MANAGER, f.window, ready());
    assert.equal(preview.eligible, 1); assert.equal(preview.messages[0].sender, "no-reply@aicaseleads.com");
    assert.deepEqual(preview.messages[0].replyTo, ["no-reply@aicaseleads.com"]);
  } finally { f.database.close(); }
});
test("individual recovery cannot revive cancelled or provider-confirmed delivery even if the task says failed", async () => {
  const f = await fixture(2);
  try {
    f.database.prepare("UPDATE hub_communications SET status='cancelled' WHERE application_id=?").run(f.ids[0]);
    f.database.prepare("UPDATE hub_communications SET status='sent',provider_id='confirmed-message' WHERE application_id=?").run(f.ids[1]);
    for (const id of f.ids) await assert.rejects(f.store.retryTask(`gmail:${id}:confirmation`), { code: "task_not_retryable" });
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE kind='gmail' AND status='pending'").get()!.n, 0);
  } finally { f.database.close(); }
});
