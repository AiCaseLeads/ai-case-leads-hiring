import test from "node:test";
import assert from "node:assert/strict";
import { createStore, MANAGER, RECRUITER } from "./fixtures";
import { processStaffInvites, staffInput, updateStaff } from "../../lib/staff/service";
import type { AutomaticMailTransport } from "../../lib/email/service";
import type { MailInput } from "../../lib/google/gmail";

const owners = [MANAGER.email], origin = "https://jobs.example.invalid", key = `staff_invite:${RECRUITER.email}`;
const input = staffInput.parse({ email: RECRUITER.email, role: "recruiter", active: true, sendInvite: true });
async function fixture() {
  const f = createStore();
  await updateStaff(f.store, MANAGER, owners, input, origin);
  return f;
}
function provider(overrides: Partial<AutomaticMailTransport> = {}): AutomaticMailTransport {
  return { fingerprint: "provider-fingerprint", verify: async () => undefined, sendMail: async () => ({ id: "sendgrid-id", provider: "sendgrid" }), reconcileMail: async () => null, ...overrides };
}

test("staff invitations send through verified automatic email without Google and persist the provider before POST", async () => {
  const f = await fixture(), observed: MailInput[] = [];
  let verified = false;
  try {
    const transport = provider({ verify: async () => { verified = true; }, sendMail: async mail => {
      const pinned = await f.store.setting<Record<string, unknown>>(key, {});
      assert.equal(verified, true); assert.equal(pinned.status, "running");
      assert.equal(pinned.deliveryProvider, "sendgrid"); assert.equal(pinned.deliveryFingerprint, transport.fingerprint);
      assert.equal(typeof pinned.deliveryStartedAt, "number");
      observed.push(mail); return { id: "sendgrid-id", provider: "sendgrid" };
    } });
    const result = await processStaffInvites(f.store, null, owners, 3, async () => transport);
    assert.equal(result.sent, 1); assert.equal(observed.length, 1);
    assert.equal(observed[0].to, RECRUITER.email); assert.equal(observed[0].sender, "no-reply@notify.aicaseleads.com");
    assert.deepEqual(observed[0].replyTo, ["no-reply@notify.aicaseleads.com"]);
    assert.match(observed[0].body, /\/recruiter-guide.pdf/);
    const saved = await f.store.setting<Record<string, unknown>>(key, {});
    assert.equal(saved.status, "sent"); assert.equal(saved.providerId, "sendgrid-id"); assert.equal(saved.threadId, undefined);
    await processStaffInvites(f.store, null, owners, 3, async () => transport); assert.equal(observed.length, 1);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_applications").get()?.n, 0);
  } finally { f.database.close(); }
});

test("concurrent automatic invitation workers emit one provider request", async () => {
  const f = await fixture(); let sends = 0;
  try {
    const resolve = async () => provider({ sendMail: async () => { sends++; return { id: "sendgrid-id", provider: "sendgrid" }; } });
    await Promise.all([processStaffInvites(f.store, null, owners, 3, resolve), processStaffInvites(f.store, null, owners, 3, resolve)]);
    assert.equal(sends, 1);
  } finally { f.database.close(); }
});

for (const status of ["running", "uncertain"] as const) test(`legacy ${status} invitations reconcile only in Gmail after switching automatic providers`, async () => {
  const f = await fixture(); let gmailReads = 0, automaticCalls = 0;
  try {
    const saved = await f.store.setting<Record<string, unknown>>(key, {});
    await f.store.setSetting(key, { ...saved, status, leaseUntil: 0, runAfter: 0 });
    await processStaffInvites(f.store, { sendMail: async () => { throw new Error("Must never resend"); }, reconcileMail: async () => { gmailReads++; return null; } }, owners, 3, async () => { automaticCalls++; return provider(); });
    assert.equal(gmailReads, 1); assert.equal(automaticCalls, 0);
    assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "uncertain");
    await f.store.setSetting(key, { ...await f.store.setting<Record<string, unknown>>(key, {}), runAfter: 0 });
    await processStaffInvites(f.store, null, owners, 3, async () => { automaticCalls++; return provider(); });
    assert.equal(automaticCalls, 0); assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "uncertain");
  } finally { f.database.close(); }
});

test("an ambiguous SendGrid invitation only reconciles with the same account and never sends twice", async () => {
  const f = await fixture(); let sends = 0, reads = 0;
  try {
    const transport = provider({ sendMail: async () => { sends++; throw { code: "transactional_mail_network_error", uncertain: true }; }, reconcileMail: async (messageId, to, startedAt) => {
      reads++; assert.equal(to, RECRUITER.email); assert.equal(typeof startedAt, "number");
      assert.equal(messageId, (await f.store.setting<Record<string, unknown>>(key, {})).messageId);
      return reads > 1 ? { id: "confirmed", provider: "sendgrid" } : null;
    } });
    await processStaffInvites(f.store, null, owners, 3, async () => transport);
    assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "uncertain");
    for (let i = 0; i < 2; i++) {
      await f.store.setSetting(key, { ...await f.store.setting<Record<string, unknown>>(key, {}), runAfter: 0 });
      await processStaffInvites(f.store, null, owners, 3, async () => transport);
    }
    assert.equal(sends, 1); assert.equal(reads, 2);
    assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "sent");
  } finally { f.database.close(); }
});

test("SendGrid key rotation cannot reconcile an uncertain invitation through a different account", async () => {
  const f = await fixture(); let reads = 0, sends = 0;
  try {
    await f.store.setSetting(key, { ...await f.store.setting<Record<string, unknown>>(key, {}), status: "uncertain", runAfter: 0, deliveryProvider: "sendgrid", deliveryFingerprint: "old-account", deliveryStartedAt: Date.now() });
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ reconcileMail: async () => { reads++; return null; }, sendMail: async () => { sends++; return { id: "bad" }; } }));
    assert.equal(reads, 0); assert.equal(sends, 0);
    const saved = await f.store.setting<Record<string, unknown>>(key, {});
    assert.equal(saved.status, "uncertain"); assert.equal(saved.lastError, "transactional_mail_configuration_changed");
  } finally { f.database.close(); }
});

test("daily quota defers staff invitations without consuming retry attempts or entering POST", async () => {
  const f = await fixture(); let sends = 0;
  try {
    await f.store.setSetting(`automatic_mail_budget:${new Date().toISOString().slice(0, 10)}`, 100_000);
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ sendMail: async () => { sends++; return { id: "bad" }; } }));
    const saved = await f.store.setting<Record<string, unknown>>(key, {});
    assert.equal(sends, 0); assert.equal(saved.status, "pending"); assert.equal(saved.attempts, 0);
    assert.equal(saved.lastError, "transactional_mail_daily_limit"); assert.ok(Number(saved.runAfter) > Date.now());
  } finally { f.database.close(); }
});

test("definite provider rate rejection defers rather than exhausting staff invitation retries", async () => {
  const f = await fixture(), retryAt = Date.now() + 120_000;
  try {
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ sendMail: async () => { throw { code: "transactional_mail_rate_limited", uncertain: false, retryAt }; } }));
    const saved = await f.store.setting<Record<string, unknown>>(key, {});
    assert.equal(saved.status, "pending"); assert.equal(saved.attempts, 0); assert.equal(saved.runAfter, retryAt);
  } finally { f.database.close(); }
});

test("missing automatic configuration holds invites until an administrator explicitly resends", async () => {
  const f = await fixture(); let sends = 0;
  try {
    await processStaffInvites(f.store, null, owners, 3, async () => { throw { code: "transactional_mail_key_required", uncertain: false }; });
    const saved = await f.store.setting<Record<string, unknown>>(key, {});
    assert.equal(saved.status, "failed"); assert.equal(saved.runAfter, Number.MAX_SAFE_INTEGER); assert.equal(saved.attempts, 0);
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ sendMail: async () => { sends++; return { id: "bad" }; } }));
    assert.equal(sends, 0);
    await f.store.setSetting(key, { ...saved, createdAt: Date.now() - 6 * 60_000 });
    await updateStaff(f.store, MANAGER, owners, { ...input, resendInvite: true }, origin);
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ sendMail: async () => { sends++; return { id: "sent", provider: "sendgrid" }; } }));
    assert.equal(sends, 1); assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "sent");
  } finally { f.database.close(); }
});

test("a concurrent cancellation during provider verification fences invitation delivery", async () => {
  const f = await fixture(); let sends = 0;
  try {
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ verify: async () => {
      await updateStaff(f.store, MANAGER, owners, { ...input, active: false, sendInvite: false }, origin);
    }, sendMail: async () => { sends++; return { id: "bad" }; } }));
    assert.equal(sends, 0); assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "cancelled");
  } finally { f.database.close(); }
});

test("unknown errors inside provider POST remain uncertain and cannot create a second invitation", async () => {
  const f = await fixture();
  try {
    await processStaffInvites(f.store, null, owners, 3, async () => provider({ sendMail: async () => { throw new Error("Unexpected provider failure"); } }));
    assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "uncertain");
    await assert.rejects(updateStaff(f.store, MANAGER, owners, { ...input, resendInvite: true }, origin), /awaiting delivery/);
  } finally { f.database.close(); }
});

test("provider acceptance followed by a failed database write only reconciles after lease expiry", async () => {
  const f = await fixture(); let sends = 0, reads = 0;
  try {
    const transport = provider({ sendMail: async () => { sends++; return { id: "accepted", provider: "sendgrid" }; }, reconcileMail: async () => { reads++; return { id: "accepted", provider: "sendgrid" }; } });
    f.database.exec("CREATE TRIGGER staff_sent_persist_failure BEFORE UPDATE ON hub_settings WHEN NEW.key LIKE 'staff_invite:%' AND json_extract(NEW.value,'$.status')='sent' BEGIN SELECT RAISE(ABORT,'synthetic persist failure'); END");
    await assert.rejects(processStaffInvites(f.store, null, owners, 3, async () => transport), /synthetic persist failure/);
    const pinned = await f.store.setting<Record<string, unknown>>(key, {});
    assert.equal(pinned.status, "running"); assert.equal(pinned.deliveryProvider, "sendgrid"); assert.equal(sends, 1);
    f.database.exec("DROP TRIGGER staff_sent_persist_failure");
    await f.store.setSetting(key, { ...pinned, leaseUntil: 0 });
    await processStaffInvites(f.store, null, owners, 3, async () => transport);
    assert.equal(sends, 1); assert.equal(reads, 1);
    assert.equal((await f.store.setting<Record<string, unknown>>(key, {})).status, "sent");
  } finally { f.database.close(); }
});
