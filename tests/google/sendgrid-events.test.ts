import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createStore } from "../hub/fixtures";
import { sha256 } from "../../lib/hiring/crypto";
import { normalizedMessageId } from "../../lib/google/gmail";
import { handleSendgridEventWebhook, readSendgridEvidence, receiveSendgridEvents, verifySendgridEventSignature, SENDGRID_EVENT_MAX_BYTES, SENDGRID_SIGNATURE_HEADER, SENDGRID_TIMESTAMP_HEADER } from "../../lib/email/sendgrid-events";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const encodedKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const now = Date.now(), timestamp = String(Math.floor(now / 1_000)), messageId = "<application-receipt-test@jobs.example.invalid>", recipient = "candidate@example.invalid";
async function event(overrides: Record<string, unknown> = {}) {
  return { email: recipient, timestamp: Math.floor(now / 1_000), event: "processed", sg_event_id: "event-1", sg_message_id: "sendgrid-id.filter0001.16648.5515E0B88.0000000000000", aicl_message: await sha256(normalizedMessageId(messageId)), ...overrides };
}
function body(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }
function signed(raw: Uint8Array, ts = timestamp): string { return sign("sha256", Buffer.concat([Buffer.from(ts), Buffer.from(raw)]), privateKey).toString("base64"); }
function request(raw: Uint8Array, overrides: Record<string, string> = {}): Request {
  return new Request("https://jobs.example.invalid/api/webhooks/sendgrid", { method: "POST", headers: { "content-type": "application/json", [SENDGRID_TIMESTAMP_HEADER]: timestamp, [SENDGRID_SIGNATURE_HEADER]: signed(raw), ...overrides }, body: new Uint8Array(raw).buffer });
}
async function count(store: ReturnType<typeof createStore>["store"], prefix = "sendgrid_event:") {
  return (await store.stmt("SELECT COUNT(*) n FROM hub_settings WHERE key LIKE ?", `${prefix}%`).first<{ n: number }>())!.n;
}

test("verification matches SendGrid's published independent signature fixture and preserves trailing CRLF", async () => {
  // Public test vector from SendGrid's MIT-licensed helper, not account credentials:
  // https://github.com/sendgrid/sendgrid-nodejs/blob/main/packages/eventwebhook/src/eventwebhook.spec.js
  const fixtureKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE83T4O/n84iotIvIW4mdBgQ/7dAfSmpqIM8kF9mN1flpVKS3GRqe62gw+2fNNRaINXvVpiglSI8eNEc6wEA3F+g==";
  const fixtureSignature = "MEUCIGHQVtGj+Y3LkG9fLcxf3qfI10QysgDWmMOVmxG0u6ZUAiEAyBiXDWzM+uOe5W0JuG+luQAbPIqHh89M15TluLtEZtM=", fixtureTimestamp = "1600112502";
  const fixturePayload = new TextEncoder().encode(JSON.stringify([{ email: "hello@world.com", event: "dropped", reason: "Bounced Address", sg_event_id: "ZHJvcC0xMDk5NDkxOS1MUnpYbF9OSFN0T0doUTRrb2ZTbV9BLTA", sg_message_id: "LRzXl_NHStOGhQ4kofSm_A.filterdrecv-p3mdw1-756b745b58-kmzbl-18-5F5FC76C-9.0", "smtp-id": "<LRzXl_NHStOGhQ4kofSm_A@ismtpd0039p1iad1.sendgrid.net>", timestamp: 1600112492 }]) + "\r\n");
  await verifySendgridEventSignature(fixturePayload, fixtureTimestamp, fixtureSignature, fixtureKey, Number(fixtureTimestamp) * 1_000);
  await assert.rejects(verifySendgridEventSignature(fixturePayload.slice(0, -2), fixtureTimestamp, fixtureSignature, fixtureKey, Number(fixtureTimestamp) * 1_000), { code: "sendgrid_signature_invalid" });
});

test("real ECDSA SHA256 SendGrid signatures store bounded evidence, with no public PII or hiring writes", async () => {
  const f = createStore(), raw = body([await event()]);
  try {
    const response = await handleSendgridEventWebhook(request(raw), f.store, encodedKey, now);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text(); assert.equal(text.includes(recipient), false); assert.equal(text.includes("sendgrid-id"), false);
    assert.deepEqual(JSON.parse(text), { received: true, accepted: 1, duplicates: 0, ignored: 0 });
    assert.equal(await count(f.store), 1); assert.equal(await count(f.store, "sendgrid_mail:"), 1);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_applications").get()?.n, 0);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_tasks").get()?.n, 0);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_history").get()?.n, 0);
    const evidence = await readSendgridEvidence(f.store, messageId, recipient);
    assert.equal(evidence?.id, "sendgrid-id"); assert.equal(evidence?.provider, "sendgrid");
    assert.equal(evidence?.accepted, true); assert.equal(evidence?.delivered, false); assert.equal(evidence?.failed, false);
  } finally { f.database.close(); }
});

test("PEM-encoded public keys verify the same provider signature", async () => {
  const f = createStore(), raw = body([await event()]);
  try {
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.equal((await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), pem, now)).accepted, 1);
  } finally { f.database.close(); }
});

const invalidHeaders: Array<Record<string, string>> = [{ [SENDGRID_SIGNATURE_HEADER]: "" }, { [SENDGRID_TIMESTAMP_HEADER]: "" }, { [SENDGRID_SIGNATURE_HEADER]: "invalid" }, { [SENDGRID_TIMESTAMP_HEADER]: String(Number(timestamp) - 301) }, { [SENDGRID_TIMESTAMP_HEADER]: String(Number(timestamp) + 301) }];
for (const headers of invalidHeaders) {
  test(`unsigned, malformed, or stale webhook is rejected before opening the private store: ${JSON.stringify(headers)}`, async () => {
    let opened = false;
    const raw = body([await event()]);
    const response = await handleSendgridEventWebhook(request(raw, headers), async () => { opened = true; throw new Error("Must not open"); }, encodedKey, now);
    assert.equal(response.status, 401); assert.equal(opened, false);
  });
}

test("body bytes and timestamp must match exactly, including whitespace and multibyte characters", async () => {
  const f = createStore(), original = body([await event({ extra: "résumé" })]);
  try {
    const changed = new TextEncoder().encode(new TextDecoder().decode(original) + " ");
    await assert.rejects(receiveSendgridEvents(f.store, changed, timestamp, signed(original), encodedKey, now), { code: "sendgrid_signature_invalid" });
    await assert.rejects(receiveSendgridEvents(f.store, original, String(Number(timestamp) - 1), signed(original), encodedKey, now), { code: "sendgrid_signature_invalid" });
    assert.equal(await count(f.store), 0);
    assert.equal((await receiveSendgridEvents(f.store, original, timestamp, signed(original), encodedKey, now)).accepted, 1);
  } finally { f.database.close(); }
});

test("wrong signing key, malformed DER, and missing server key cannot authorize writes", async () => {
  const f = createStore(), raw = body([await event()]);
  try {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
    await assert.rejects(receiveSendgridEvents(f.store, raw, timestamp, signed(raw), other, now), { code: "sendgrid_signature_invalid" });
    await assert.rejects(receiveSendgridEvents(f.store, raw, timestamp, Buffer.alloc(64).toString("base64"), encodedKey, now), { code: "sendgrid_signature_invalid" });
    await assert.rejects(receiveSendgridEvents(f.store, raw, timestamp, signed(raw), undefined, now), { code: "sendgrid_webhook_not_configured" });
    assert.equal(await count(f.store), 0);
  } finally { f.database.close(); }
});

test("a fresh signed retry and duplicate callbacks in one batch do not add duplicate evidence", async () => {
  const f = createStore(), e = await event();
  try {
    const raw = body([e, e]);
    assert.deepEqual(await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now), { accepted: 1, duplicates: 1, ignored: 0 });
    assert.deepEqual(await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now + 1_000), { accepted: 0, duplicates: 2, ignored: 0 });
    assert.equal(await count(f.store), 1); assert.equal(await count(f.store, "sendgrid_mail:"), 1);
  } finally { f.database.close(); }
});

test("a reused provider event ID cannot create evidence for a different recipient or original message", async () => {
  const f = createStore();
  try {
    const raw = body([await event()]); await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now);
    const other = body([await event({ email: "different@example.invalid", aicl_message: await sha256(normalizedMessageId("other@jobs.example.invalid")) })]);
    await receiveSendgridEvents(f.store, other, timestamp, signed(other), encodedKey, now + 1_000);
    assert.equal(await count(f.store), 1); assert.equal(await count(f.store, "sendgrid_mail:"), 1);
    assert.equal(await readSendgridEvidence(f.store, "other@jobs.example.invalid", "different@example.invalid"), null);
  } finally { f.database.close(); }
});

test("processed and delivered events for one provider message do not look like duplicate sends", async () => {
  const f = createStore();
  try {
    const raw = body([await event(), await event({ sg_event_id: "delivered-1", event: "delivered", sg_message_id: "sendgrid-id.filter0001.16648.5515E0B88.0" })]);
    await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now);
    assert.equal((await readSendgridEvidence(f.store, messageId, recipient))?.delivered, true);
    assert.equal(await readSendgridEvidence(f.store, messageId, "unrelated@example.invalid"), null);
    assert.equal(await readSendgridEvidence(f.store, "other@jobs.example.invalid", recipient), null);
    assert.equal(await readSendgridEvidence(f.store, messageId, recipient, now + 120_000), null);
  } finally { f.database.close(); }
});

test("two distinct provider messages for one correlation stay uncertain instead of authorizing a resend", async () => {
  const f = createStore();
  try {
    const raw = body([await event(), await event({ sg_event_id: "other-send", sg_message_id: "another-sendgrid-id.filter0001.0" })]);
    await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now);
    await assert.rejects(readSendgridEvidence(f.store, messageId, recipient), { code: "transactional_mail_duplicate_evidence", uncertain: true });
  } finally { f.database.close(); }
});

test("bounce evidence proves the provider observed the send but never changes a hiring decision", async () => {
  const f = createStore();
  try {
    const raw = body([await event({ event: "bounce" })]);
    await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now);
    const evidence = await readSendgridEvidence(f.store, messageId, recipient);
    assert.equal(evidence?.accepted, true); assert.equal(evidence?.failed, true); assert.equal(evidence?.delivered, false);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_history").get()?.n, 0);
  } finally { f.database.close(); }
});

test("unrelated account events without application correlation are ignored", async () => {
  let opened = false;
  const e = await event(); delete (e as { aicl_message?: string }).aicl_message;
  const raw = body([e]);
  const result = await receiveSendgridEvents(async () => { opened = true; throw new Error("No useful data"); }, raw, timestamp, signed(raw), encodedKey, now);
  assert.deepEqual(result, { accepted: 0, duplicates: 0, ignored: 1 }); assert.equal(opened, false);
});

test("unrelated account status and future event types cannot block a valid application delivery batch", async () => {
  const f = createStore();
  try {
    const raw = body([{ event: "account_status_change", sg_event_id: "account-1", timestamp: 1709142428, type: "compliance_suspend" }, { event: "future-provider-event", another_shape: true }, await event()]);
    const result = await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now);
    assert.deepEqual(result, { accepted: 1, duplicates: 0, ignored: 2 });
    assert.equal(await count(f.store), 1); assert.equal(await count(f.store, "sendgrid_mail:"), 1);
    assert.equal((await readSendgridEvidence(f.store, messageId, recipient))?.accepted, true);
  } finally { f.database.close(); }
});

test("batches containing only untagged account status events never open private application storage", async () => {
  let opened = false;
  const raw = body([{ event: "account_status_change", sg_event_id: "account-1", timestamp: 1709142428, type: "compliance_suspend" }, { event: "future-provider-event" }]);
  const result = await receiveSendgridEvents(async () => { opened = true; throw new Error("No application evidence"); }, raw, timestamp, signed(raw), encodedKey, now);
  assert.deepEqual(result, { accepted: 0, duplicates: 0, ignored: 2 }); assert.equal(opened, false);
});

test("invalid JSON, malformed event fields and too many events reject the whole batch without writes", async () => {
  const f = createStore();
  try {
    for (const value of [{ email: recipient }, [await event(), await event({ email: "invalid" })], [await event({ aicl_message: "not-a-sha256" })], Array.from({ length: 1_001 }, () => ({ email: recipient, timestamp: 1, event: "processed", sg_event_id: "same" }))]) {
      const raw = body(value);
      await assert.rejects(receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now), { code: "invalid_sendgrid_events" });
    }
    const raw = new TextEncoder().encode("[broken");
    await assert.rejects(receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now), { code: "invalid_sendgrid_events" });
    assert.equal(await count(f.store), 0);
  } finally { f.database.close(); }
});

test("webhook body size is bounded even without a declared content length; read methods expose no records", async () => {
  let opened = false;
  const raw = new Uint8Array(SENDGRID_EVENT_MAX_BYTES + 1);
  const response = await handleSendgridEventWebhook(request(raw), async () => { opened = true; throw new Error(); }, encodedKey, now);
  assert.equal(response.status, 413); assert.equal(opened, false);
  const read = await handleSendgridEventWebhook(new Request("https://jobs.example.invalid/api/webhooks/sendgrid"), async () => { opened = true; throw new Error(); }, encodedKey, now);
  assert.equal(read.status, 405); assert.equal(read.headers.get("allow"), "POST"); assert.equal(opened, false);
});

test("global event and recipient index are committed atomically", async () => {
  const f = createStore(), raw = body([await event()]);
  try {
    f.database.exec("CREATE TRIGGER sendgrid_index_failure BEFORE INSERT ON hub_settings WHEN NEW.key LIKE 'sendgrid_mail:%' BEGIN SELECT RAISE(ABORT,'synthetic index failure'); END");
    await assert.rejects(receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now), /synthetic index failure/);
    assert.equal(await count(f.store), 0); assert.equal(await count(f.store, "sendgrid_mail:"), 0);
    f.database.exec("DROP TRIGGER sendgrid_index_failure");
    assert.equal((await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now)).accepted, 1);
  } finally { f.database.close(); }
});

test("a bounded burst of 1,000 signed events commits once and repeated delivery stays deduplicated", async () => {
  const f = createStore(), e = await event();
  try {
    const raw = body(Array.from({ length: 1_000 }, (_, index) => ({ ...e, sg_event_id: `bulk-event-${index}`, aicl_message: index.toString(16).padStart(64, "0") })));
    assert.ok(raw.byteLength < SENDGRID_EVENT_MAX_BYTES);
    assert.equal((await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now)).accepted, 1_000);
    assert.equal(await count(f.store), 1_000); assert.equal(await count(f.store, "sendgrid_mail:"), 1_000);
    const repeated = await receiveSendgridEvents(f.store, raw, timestamp, signed(raw), encodedKey, now + 1_000);
    assert.equal(repeated.accepted, 0); assert.equal(repeated.duplicates, 1_000);
    assert.equal(await count(f.store), 1_000); assert.equal(await count(f.store, "sendgrid_mail:"), 1_000);
  } finally { f.database.close(); }
});
