import test from "node:test";
import assert from "node:assert/strict";
import { SendGridError, SendGridMail, sendgridApiKeyFingerprint, sendgridMessageIdentity, TRANSACTIONAL_MAIL_NAME, TRANSACTIONAL_MAIL_SENDER, type SendGridMailOptions } from "../../lib/email/sendgrid";
import { AUTOMATIC_REPLY_TO, AUTOMATIC_REPLY_DOMAIN, AUTOMATIC_MAIL_DOMAIN } from '../../lib/email/contracts';
import type { MailInput } from "../../lib/google/gmail";

const apiKey = "fixture-sendgrid-key-do-not-log", now = Date.parse("2026-10-16T12:00:00Z");
const mail: MailInput = { to: "Candidate@example.com", subject: "Application received — Zoë", body: "Hello Zoë,\nWe received <your> application & résumé.", messageId: "application-123-confirmation@jobs.aicaseleads.com", sender: TRANSACTIONAL_MAIL_SENDER, replyTo: [AUTOMATIC_REPLY_TO], candidateMail: true, candidateAccount: "mariam@aicaseleads.com" };
test("automatic From uses the deliverable authenticated root, distinct from the Null MX Reply-To", () => {
  assert.equal(TRANSACTIONAL_MAIL_SENDER, "no-reply-recruiting@aicaseleads.com");
  assert.notEqual(AUTOMATIC_MAIL_DOMAIN, AUTOMATIC_REPLY_DOMAIN);
  assert.equal(AUTOMATIC_REPLY_TO, "no-reply@notify.aicaseleads.com");
});
function response(value: unknown, status = 200, headers: Record<string, string> = {}): Response { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } }); }
function accepted(id = "provider-123"): Response { return new Response(null, { status: 202, headers: { "x-message-id": id } }); }
type ProviderCall = (path: string, init: RequestInit, url: URL) => Promise<Response> | Response;
function fixture(call: ProviderCall = () => accepted(), options: Partial<SendGridMailOptions> = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); calls.push({ url, init });
    assert.equal(url.origin, "https://api.sendgrid.com"); assert.equal(init.redirect, "manual");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${apiKey}`);
    assert.equal(new Headers(init.headers).get("api-key"), null); assert.ok(init.signal instanceof AbortSignal);
    if (url.pathname === "/v3/whitelabel/domains") return response([{ domain: "aicaseleads.com", valid: true, user_id: 123, username: "private-admin@example.com" }]);
    return call(url.pathname, init, url);
  };
  return { client: new SendGridMail({ apiKey, fetcher, now: () => now, cacheReadiness: false, ...options }), calls };
}
function isError(code: string, uncertain = false, status?: number) {
  return (error: unknown) => { assert.ok(error instanceof SendGridError); assert.equal(error.code, code); assert.equal(error.uncertain, uncertain); if (status !== undefined) assert.equal(error.status, status); assert.equal(error.message.includes(apiKey), false); return true; };
}

test("SendGrid uses one fixed branded no-reply envelope and no private account, CC/BCC or Gmail thread", async () => {
  const { client, calls } = fixture();
  const result = await client.send(mail), identity = await sendgridMessageIdentity(mail.messageId);
  assert.deepEqual(result, { id: "provider-123", provider: "sendgrid", tag: identity.tag, accepted: true }); assert.equal("threadId" in result, false);
  const request = calls.find(call => call.init.method === "POST")!;
  assert.equal(request.url.pathname, "/v3/mail/send");
  const payload = JSON.parse(String(request.init.body));
  assert.deepEqual(payload.from, { email: "no-reply-recruiting@aicaseleads.com", name: TRANSACTIONAL_MAIL_NAME });
  assert.deepEqual(payload.reply_to, { email: AUTOMATIC_REPLY_TO, name: TRANSACTIONAL_MAIL_NAME });
  assert.deepEqual(payload.personalizations, [{ to: [{ email: "candidate@example.com" }], custom_args: { aicl_message: identity.tag } }]);
  assert.deepEqual(payload.content[0], { type: "text/plain", value: mail.body });
  assert.ok(payload.content[1].value.includes("&lt;your&gt; application &amp; résumé"));
  assert.equal(payload.headers["X-AICL-Message-ID"], `<${mail.messageId}>`);
  assert.equal(payload.headers["Message-ID"], undefined); assert.equal(payload.headers.IdempotencyKey, undefined);
  assert.equal(payload.cc, undefined); assert.equal(payload.bcc, undefined);
  assert.equal(JSON.stringify(payload).includes("mariam@"), false); assert.equal(JSON.stringify(payload).includes("private-admin"), false);
  assert.deepEqual(payload.tracking_settings, { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } });
});

test("message identity is normalized, deterministic and has no invented provider idempotency guarantee", async () => {
  const identity = await sendgridMessageIdentity(mail.messageId);
  assert.deepEqual(await sendgridMessageIdentity(`<${mail.messageId}>`), identity); assert.match(identity.tag, /^[a-f0-9]{64}$/);
  assert.notEqual((await sendgridMessageIdentity("application-456@jobs.aicaseleads.com")).tag, identity.tag);
  assert.equal("idempotencyKey" in identity, false);
  await assert.rejects(sendgridMessageIdentity("bad\r\nBcc: victim@example.com"), isError("transactional_mail_message_id_invalid"));
});

test("readiness returns sanitized exact authenticated domain/account only", async () => {
  const { client, calls } = fixture();
  assert.deepEqual(await client.verifySender(), { sender: TRANSACTIONAL_MAIL_SENDER, domain: "aicaseleads.com", verified: true, accountId: "sendgrid-user-123" });
  assert.equal(calls[0].url.pathname, "/v3/whitelabel/domains"); assert.equal(calls[0].url.searchParams.get("limit"), "100");
});

test("credential fingerprint is stable, key rotation differs, malformed/missing keys fail safely", async () => {
  const { client } = fixture();
  const fingerprint = await client.identityFingerprint(); assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, await sendgridApiKeyFingerprint(apiKey)); assert.notEqual(fingerprint, await sendgridApiKeyFingerprint("other-key"));
  assert.throws(() => new SendGridMail({ apiKey: "" }), isError("transactional_mail_key_required"));
  assert.throws(() => new SendGridMail({ apiKey: "bad\r\nkey" }), isError("transactional_mail_auth_required"));
});

for (const [name, data] of [
  ["no authenticated domains", []],
  ["Null MX reply domain alone", [{ domain: "notify.aicaseleads.com", valid: true }]],
  ["deceptive domain", [{ domain: "aicaseleads.com.evil.com", valid: true }]],
  ["unverified exact domain", [{ domain: "aicaseleads.com", valid: false }]],
] as const) test(`readiness rejects ${name} before any send`, async () => {
  let sends = 0;
  const fetcher: typeof fetch = async (_input, init = {}) => { if (init.method === "POST") sends++; return response(data); };
  await assert.rejects(new SendGridMail({ apiKey, fetcher, cacheReadiness: false }).send(mail), isError("transactional_mail_domain_not_verified")); assert.equal(sends, 0);
});

test("domain readiness paginates and bounds malformed/oversized lists", async () => {
  const offsets: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); offsets.push(url.searchParams.get("offset")!);
    return response(url.searchParams.get("offset") === "0" ? Array.from({ length: 100 }, () => ({ domain: "elsewhere.example", valid: true })) : [{ domain: "aicaseleads.com", valid: true }]);
  };
  assert.equal((await new SendGridMail({ apiKey, fetcher, cacheReadiness: false }).verifySender()).verified, true); assert.deepEqual(offsets, ["0", "100"]);
  const bad = new SendGridMail({ apiKey, fetcher: async () => response({ domains: [] }), cacheReadiness: false });
  await assert.rejects(bad.verifySender(), isError("transactional_mail_response_invalid"));
  const tooLarge = new SendGridMail({ apiKey, fetcher: async () => response(Array.from({ length: 101 }, () => ({}))), cacheReadiness: false });
  await assert.rejects(tooLarge.verifySender(), isError("transactional_mail_response_invalid"));
});

function sharedFixture(key: string) {
  let checks = 0, valid = true, postStatus = 202;
  const fetcher: typeof fetch = async input => {
    if (new URL(String(input)).pathname === "/v3/whitelabel/domains") { checks++; await new Promise(resolve => setTimeout(resolve, 5)); return response([{ domain: "aicaseleads.com", valid, user_id: 7 }]); }
    return postStatus === 202 ? accepted() : response({ errors: [{ message: "Permission denied" }] }, postStatus);
  };
  return { client: (options: Partial<SendGridMailOptions> = {}) => new SendGridMail({ apiKey: key, fetcher, now: () => now, ...options }), count: () => checks, setValid: (value: boolean) => { valid = value; }, rejectSends: () => { postStatus = 401; } };
}

test("fresh clients coalesce readiness and cache successful exact-key checks for five minutes", async () => {
  const shared = sharedFixture("sendgrid-shared-coalesce");
  const result = await Promise.all([shared.client().verifySender(), shared.client().verifySender(), shared.client().verifySender()]);
  assert.deepEqual(result[0], result[1]); assert.equal(shared.count(), 1);
  await shared.client().send(mail); assert.equal(shared.count(), 1);
  await shared.client({ now: () => now + 5 * 60_000 }).verifySender(); assert.equal(shared.count(), 2);
  const rotated = sharedFixture("sendgrid-shared-rotated-key"); await rotated.client().verifySender(); assert.equal(rotated.count(), 1);
});

test("negative readiness is not cached and revoked key invalidates shared positive readiness", async () => {
  const negative = sharedFixture("sendgrid-shared-negative"); negative.setValid(false);
  await assert.rejects(negative.client().verifySender(), isError("transactional_mail_domain_not_verified"));
  negative.setValid(true); await negative.client().verifySender(); assert.equal(negative.count(), 2);
  negative.rejectSends(); await assert.rejects(negative.client().send(mail), isError("transactional_mail_auth_required", false, 401));
  negative.setValid(false); await assert.rejects(negative.client().verifySender(), isError("transactional_mail_domain_not_verified")); assert.equal(negative.count(), 3);
});

test("coalesced callers retain independent deadlines", async () => {
  // Keep the provider pending until the short caller times out. Relative 1 ms/5 ms
  // timers can both be due after an event-loop stall and resolve in registration order.
  let checks = 0, release!: () => void, entered!: () => void;
  const providerPending = new Promise<void>(resolve => { release = resolve; });
  const providerEntered = new Promise<void>(resolve => { entered = resolve; });
  const fetcher: typeof fetch = async () => {
    checks++; entered(); await providerPending;
    return response([{ domain: "aicaseleads.com", valid: true, user_id: 7 }]);
  };
  const client = () => new SendGridMail({ apiKey: "sendgrid-shared-deadlines", fetcher, now: () => now });
  const long = client(), short = client();
  long.setDeadline(now + 60_000); short.setDeadline(now + 1);
  const pending = long.verifySender(); await providerEntered;
  try { await assert.rejects(short.verifySender(), isError("processor_deadline_exceeded")); }
  finally { release(); }
  assert.equal((await pending).verified, true); assert.equal(checks, 1);
});

test("private addresses and malformed envelopes fail before any external request", async () => {
  const { client, calls } = fixture();
  for (const [changed, code] of [
    [{ sender: "sales@aicaseleads.com" }, "transactional_mail_sender_not_allowed"],
    [{ sender: "no-reply@aicaseleads.com" }, "transactional_mail_sender_not_allowed"],
    [{ sender: "mariam@aicaseleads.com" }, "transactional_mail_sender_not_allowed"],
    [{ sender: AUTOMATIC_REPLY_TO }, "transactional_mail_sender_not_allowed"],
    [{ replyTo: [TRANSACTIONAL_MAIL_SENDER] }, "transactional_mail_reply_to_not_allowed"],
    [{ replyTo: ["mariam@aicaseleads.com"] }, "transactional_mail_reply_to_not_allowed"],
    [{ replyTo: [TRANSACTIONAL_MAIL_SENDER, "mariam@aicaseleads.com"] }, "transactional_mail_reply_to_not_allowed"],
    [{ to: "victim@example.com\r\nBCC:other@example.com" }, "transactional_mail_recipient_invalid"],
    [{ subject: "bad\nsubject" }, "transactional_mail_subject_invalid"],
    [{ body: "a".repeat(1_000_001) }, "transactional_mail_body_invalid"],
    [{ messageId: "not-an-id" }, "transactional_mail_message_id_invalid"],
  ] as const) await assert.rejects(client.send({ ...mail, ...changed } as MailInput), isError(code));
  assert.equal(calls.length, 0);
});

test("401/403 are safe actionable key/scope errors; provider credits failure is distinct", async () => {
  for (const status of [401, 403]) {
    const { client } = fixture(() => response({ errors: [{ message: "Permission denied" }] }, status));
    await assert.rejects(client.send(mail), isError("transactional_mail_auth_required", false, status));
  }
  const quota = fixture(() => response({ errors: [{ message: "Maximum credits exceeded" }] }, 403));
  await assert.rejects(quota.client.send(mail), error => { isError("transactional_mail_quota_exhausted", false, 403)(error); assert.equal((error as SendGridError).retryAt, Date.parse("2026-10-17T00:00:00Z")); return true; });
  const domain = fixture(() => response({ errors: [{ message: "The from address does not match a verified Sender Identity" }] }, 403));
  await assert.rejects(domain.client.send(mail), isError("transactional_mail_domain_not_verified", false, 403));
});

test("429 honors Retry-After and SendGrid absolute rate reset, without automatic retry", async () => {
  for (const [headers, retryAt] of [
    [{ "Retry-After": "120" }, now + 120_000], [{ "Retry-After": new Date(now + 90_000).toUTCString() }, now + 90_000],
    [{ "x-ratelimit-reset": String((now + 45_000) / 1000) }, now + 45_000], [{}, now + 60_000],
  ] as const) {
    const { client, calls } = fixture(() => response({}, 429, headers));
    await assert.rejects(client.send(mail), error => { isError("transactional_mail_rate_limited", false, 429)(error); assert.equal((error as SendGridError).retryAt, retryAt); return true; });
    assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
  }
});

test("uncertain network/5xx/408/redirect writes never resend and never leak raw provider errors", async () => {
  for (const [call, code, status] of [
    [() => { throw new Error(`network failure including ${apiKey}`); }, "transactional_mail_network_error", 0],
    [() => response({}, 503), "transactional_mail_provider_error", 503], [() => response({}, 408), "transactional_mail_provider_error", 408],
    [() => response({}, 307, { Location: "https://attacker.example" }), "transactional_mail_redirect_rejected", 307],
  ] as Array<[ProviderCall, string, number]>) {
    const { client, calls } = fixture(call); await assert.rejects(client.send(mail), isError(code, true, status)); assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
  }
});

test("202 missing provider ID and unexpected successful status remain uncertain", async () => {
  for (const result of [new Response(null, { status: 202 }), response({ messageId: "invented-body-id" }, 200), new Response(null, { status: 204 })]) {
    const { client, calls } = fixture(() => result); await assert.rejects(client.send(mail), isError("transactional_mail_response_invalid", true)); assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
  }
});

test("expired deadline blocks external requests and may be reset before another task", async () => {
  const { client, calls } = fixture(); client.setDeadline(now);
  await assert.rejects(client.send(mail), isError("processor_deadline_exceeded")); assert.equal(calls.length, 0);
  client.setDeadline(now + 20_000); assert.equal((await client.send(mail)).accepted, true);
});

test("Activity API is disabled by default: unresolved evidence performs no request and does not buy a plan", async () => {
  const { client, calls } = fixture(undefined, { activityEnabled: false });
  assert.equal(await client.reconcile(mail.messageId, mail.to), null); assert.equal(calls.length, 0);
});

test("optional Activity evidence checks exact custom hash, envelope and detailed ID", async () => {
  const identity = await sendgridMessageIdentity(mail.messageId), summary = { from_email: TRANSACTIONAL_MAIL_SENDER, to_email: "candidate@example.com", msg_id: "activity-provider-123", status: "delivered" };
  const { client, calls } = fixture((path, _init, url) => {
    if (path === "/v3/messages") {
      const query = url.searchParams.get("query")!;
      assert.ok(query.includes(`unique_args['aicl_message']="${identity.tag}"`)); assert.ok(query.includes('to_email="candidate@example.com"')); assert.ok(query.includes(`from_email="${TRANSACTIONAL_MAIL_SENDER}"`));
      return response({ messages: [summary] });
    }
    assert.equal(path, "/v3/messages/activity-provider-123"); return response({ ...summary, unique_args: JSON.stringify({ aicl_message: identity.tag }) });
  }, { activityEnabled: true });
  assert.deepEqual(await client.reconcile(mail.messageId, mail.to), { id: summary.msg_id, provider: "sendgrid", tag: identity.tag, accepted: true, outcome: "delivered", event: "delivered", delivered: true, failed: false });
  assert.equal(calls.length, 2); assert.equal(calls.filter(call => call.init.method === "POST").length, 0);
  // X-Message-ID is not the Activity msg_id; preserve the original accepted ID.
  assert.equal((await client.reconcile(mail.messageId, mail.to, { providerMessageId: "accepted-provider-123" }))?.id, "accepted-provider-123");
});

test("Activity absence or missing paid entitlement remains unresolved, never authorizes resend", async () => {
  for (const result of [response({ messages: [] }), response({ errors: [{ message: "Permission denied" }] }, 403), response({ errors: [{ message: "Not found" }] }, 404)]) {
    const { client, calls } = fixture(() => result, { activityEnabled: true }); assert.equal(await client.reconcile(mail.messageId, mail.to), null); assert.equal(calls.filter(call => call.init.method === "POST").length, 0);
  }
});

test("Activity wrong tag/recipient/sender cannot resolve an uncertain message", async () => {
  const identity = await sendgridMessageIdentity(mail.messageId), summary = { from_email: TRANSACTIONAL_MAIL_SENDER, to_email: "candidate@example.com", msg_id: "activity-provider", status: "delivered" };
  for (const changed of [{ unique_args: JSON.stringify({ aicl_message: "wrong-tag" }) }, { to_email: "other@example.com" }, { from_email: "mariam@aicaseleads.com" }, { msg_id: "different-id" }]) {
    const { client } = fixture(path => response(path === "/v3/messages" ? { messages: [summary] } : { ...summary, unique_args: { aicl_message: identity.tag }, ...changed }), { activityEnabled: true });
    assert.equal(await client.reconcile(mail.messageId, mail.to), null);
  }
});

test("Activity acceptance, delivery failure, duplicate conflicts and bounds remain distinct", async () => {
  const identity = await sendgridMessageIdentity(mail.messageId), row = { from_email: TRANSACTIONAL_MAIL_SENDER, to_email: "candidate@example.com", msg_id: "activity-id", status: "processed", unique_args: { aicl_message: identity.tag } };
  for (const [status, outcome] of [["processed", "accepted"], ["not_delivered", "failed"]] as const) {
    const { client } = fixture(path => response(path === "/v3/messages" ? { messages: [row] } : { ...row, status }), { activityEnabled: true });
    assert.equal((await client.reconcile(mail.messageId, mail.to))?.outcome, outcome);
  }
  const conflict = fixture((path) => response(path === "/v3/messages" ? { messages: [row, { ...row, msg_id: "second-id" }] } : { ...row, msg_id: path.endsWith("second-id") ? "second-id" : row.msg_id }), { activityEnabled: true });
  await assert.rejects(conflict.client.reconcile(mail.messageId, mail.to), isError("transactional_mail_duplicate_message", true));
  const huge = fixture(() => response({ messages: Array.from({ length: 10 }, () => row) }), { activityEnabled: true });
  await assert.rejects(huge.client.reconcile(mail.messageId, mail.to), isError("transactional_mail_reconciliation_too_large", true));
  assert.equal(huge.calls.length, 1);
});
