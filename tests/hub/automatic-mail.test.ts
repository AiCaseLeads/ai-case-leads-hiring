import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, jobInput, applicationInput, MANAGER } from './fixtures';
import { processHubTasks } from '../../lib/task-runner';
import { reserveAutomaticMail, type AutomaticMailTransport } from '../../lib/email/service';
import { AUTOMATIC_SENDER } from '../../lib/email/contracts';
import { previewMailRecovery, executeMailRecovery } from '../../lib/hub/mail-recovery';
import type { GoogleWorkspace } from '../../lib/google/workspace';

function transport(overrides: Partial<AutomaticMailTransport> = {}): AutomaticMailTransport {
  return { fingerprint: 'fixture-key', verify: async () => {}, sendMail: async () => ({ id: 'provider-message', provider: 'sendgrid', accepted: true }), reconcileMail: async () => null, ...overrides };
}
async function fixture() {
  const f = createStore(), job = await f.store.saveJob(jobInput()), app = await f.store.acceptApplication(applicationInput(job.id));
  f.database.prepare("UPDATE hub_tasks SET status='done',result_json=? WHERE kind='drive'").run(JSON.stringify({ archivedRevision: 999, archiveFormat: 'pdf-v2' }));
  return { ...f, app, id: `gmail:${app.id}:confirmation` };
}

test('automatic receipt uses SendGrid with no Google connection, preserves privacy and creates no Gmail thread', async () => {
  const f = await fixture(); let sends = 0;
  try {
    const sender = transport({ sendMail: async mail => {
      sends++; assert.equal(mail.sender, AUTOMATIC_SENDER); assert.deepEqual(mail.replyTo, [AUTOMATIC_SENDER]); assert.equal(mail.candidateAccount, undefined);
      assert.doesNotMatch(JSON.stringify(mail), /sales@|mariam@|\"(?:cc|bcc)\"/i);
      return { id: 'sendgrid-id', provider: 'sendgrid', accepted: true };
    } });
    await processHubTasks(f.store, f.db, undefined, undefined, 5, [MANAGER.email], async () => null, async () => sender);
    assert.equal(sends, 1);
    const task = (await f.store.tasks()).find(t => t.id === f.id)!;
    assert.equal(task.status, 'done'); assert.equal(task.payload.deliveryProvider, 'sendgrid'); assert.equal(task.payload.deliveryAccount, undefined);
    const communication = f.database.prepare('SELECT provider_id,thread_id,status FROM hub_communications WHERE task_id=?').get(f.id)!;
    assert.equal(communication.provider_id, 'sendgrid-id'); assert.equal(communication.thread_id, null); assert.equal(communication.status, 'sent');
  } finally { f.database.close(); }
});

test('missing transactional key holds receipts without spending attempts or falling back to recruiter Gmail', async () => {
  const f = await fixture(); let sends = 0;
  try {
    const broken = async () => { throw { code: 'transactional_mail_key_required', uncertain: false }; };
    const google = { sendMail: async () => { sends++; throw new Error('Forbidden fallback'); } } as unknown as GoogleWorkspace;
    await processHubTasks(f.store, f.db, undefined, google, 5, [MANAGER.email], async () => google, broken);
    const task = (await f.store.tasks()).find(t => t.id === f.id)!;
    assert.equal(task.status, 'failed'); assert.equal(task.attempts, 0); assert.equal(task.runAfter, Number.MAX_SAFE_INTEGER); assert.equal(task.result?.setupRequired, true); assert.equal(sends, 0);
    assert.equal((await f.store.applicationRow(f.app.id)).stage, 'Application Review');
  } finally { f.database.close(); }
});

test('provider timeout is reconciliation-only, pinned to exact provider key and recipient', async () => {
  const f = await fixture(); let sends = 0, reads = 0, identity = 'original-key';
  try {
    const resolve = async () => transport({ fingerprint: identity, sendMail: async () => { sends++; throw { code: 'transactional_mail_outcome_unknown', uncertain: true }; }, reconcileMail: async (messageId, to, startedAt) => {
      reads++; assert.ok(messageId.includes('@')); assert.equal(to, (await f.store.applicationRow(f.app.id)).email); assert.ok(startedAt! > 0);
      return { id: 'found-sendgrid-id', provider: 'sendgrid', accepted: true };
    } });
    await processHubTasks(f.store, f.db, undefined, undefined, 5, [], async () => null, resolve);
    assert.equal((await f.store.tasks()).find(t => t.id === f.id)!.status, 'uncertain');
    identity = 'changed-key'; f.database.prepare('UPDATE hub_tasks SET run_after=0 WHERE id=?').run(f.id);
    await processHubTasks(f.store, f.db, undefined, undefined, 5, [], async () => null, resolve);
    assert.equal(reads, 0); assert.equal(sends, 1); assert.equal((await f.store.tasks()).find(t => t.id === f.id)!.status, 'uncertain');
    identity = 'original-key'; f.database.prepare('UPDATE hub_tasks SET run_after=0 WHERE id=?').run(f.id);
    await processHubTasks(f.store, f.db, undefined, undefined, 5, [], async () => null, resolve);
    assert.equal(sends, 1); assert.equal(reads, 1); assert.equal((await f.store.tasks()).find(t => t.id === f.id)!.status, 'done');
  } finally { f.database.close(); }
});

test('legacy uncertain Gmail cannot migrate to SendGrid when the provider changes', async () => {
  const f = await fixture(); let reads = 0, automaticCalls = 0;
  try {
    f.database.prepare("UPDATE hub_tasks SET status='uncertain',payload_json=json_set(payload_json,'$.deliveryAccount','mariam@aicaseleads.com') WHERE id=?").run(f.id);
    const google = { reconcileMail: async () => { reads++; return null; } } as unknown as GoogleWorkspace;
    await processHubTasks(f.store, f.db, undefined, undefined, 5, [], async account => { assert.equal(account, 'mariam@aicaseleads.com'); return google; }, async () => { automaticCalls++; return transport(); });
    assert.equal(reads, 1); assert.equal(automaticCalls, 0); assert.equal((await f.store.tasks()).find(t => t.id === f.id)!.status, 'uncertain');
  } finally { f.database.close(); }
});

test('1000 simultaneous reservations cannot exceed the durable free-plan daily budget', async () => {
  const f = createStore();
  try {
    const now = Date.UTC(2026, 9, 16, 14);
    const results = await Promise.allSettled(Array.from({ length: 1000 }, () => reserveAutomaticMail(f.store, now, 300)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 300);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'transactional_mail_daily_limit').length, 700);
    assert.equal(await f.store.setting('automatic_mail_budget:2026-10-16', 0), 300);
    await reserveAutomaticMail(f.store, now + 86400_000, 300);
    assert.equal(await f.store.setting('automatic_mail_budget:2026-10-17', 0), 1);
  } finally { f.database.close(); }
});

test('quota waits preserve applications and do not exhaust the retry budget', async () => {
  const f = await fixture(); let sends = 0;
  try {
    const sender = transport({ sendMail: async () => { sends++; throw { code: 'transactional_mail_rate_limited', uncertain: false, retryAt: Date.now() + 60_000 }; } });
    for (let i = 0; i < 12; i++) {
      f.database.prepare('UPDATE hub_tasks SET run_after=0 WHERE id=?').run(f.id);
      await processHubTasks(f.store, f.db, undefined, undefined, 1, [], async () => null, async () => sender);
      const task = (await f.store.tasks()).find(t => t.id === f.id)!;
      assert.equal(task.status, 'pending'); assert.equal(task.attempts, 0); assert.ok(task.runAfter > Date.now());
    }
    assert.equal(sends, 12); assert.equal((await f.store.applicationRow(f.app.id)).stage, 'Application Review');
  } finally { f.database.close(); }
});

test('recovery verifies SendGrid independently and key changes invalidate an approved exact preview', async () => {
  const f = await fixture(); let identity = 'original';
  try {
    f.database.prepare("UPDATE hub_tasks SET status='failed',last_error='gmail_sender_alias_not_verified',run_after=? WHERE id=?").run(Number.MAX_SAFE_INTEGER, f.id);
    f.database.prepare("UPDATE hub_communications SET status='failed' WHERE task_id=?").run(f.id);
    const deps = { env: { ADMIN_EMAILS: MANAGER.email }, automatic: async () => transport({ fingerprint: identity }), resolve: async () => { throw new Error('No Gmail required'); } };
    const preview = await previewMailRecovery(f.store, MANAGER, { from: Date.now() - 60_000, to: Date.now() + 60_000 }, deps);
    assert.equal(preview.eligible, 1); assert.equal(preview.messages[0].sender, AUTOMATIC_SENDER);
    identity = 'rotated';
    await assert.rejects(executeMailRecovery(f.store, MANAGER, { planId: preview.planId, digest: preview.digest }, deps), { code: 'recovery_plan_changed' });
    assert.equal((await f.store.tasks()).find(t => t.id === f.id)!.status, 'failed');
  } finally { f.database.close(); }
});
