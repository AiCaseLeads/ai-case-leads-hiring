import test from "node:test";
import assert from "node:assert/strict";
import { GoogleError, GoogleWorkspace } from "../../lib/google/workspace";

function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const config = { clientId: "client", clientSecret: "secret", refreshToken: "refresh", sender: "recruiting@example.com" };
const mail = { to: "candidate@example.com", subject: "Interview — next step", body: "Hi Zoë,\nWe received your application.", messageId: "decision-123@jobs.example.com" };

function fixture(send: (init: RequestInit) => Promise<Response>, present = false) {
  let sends = 0, refreshes = 0;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(init.redirect, "manual");
    if (url.hostname === "oauth2.googleapis.com") { refreshes++; return response({ access_token: `access-${refreshes}`, token_type: "Bearer", expires_in: 3600 }); }
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer access-${refreshes}`);
    if (url.pathname.endsWith("/profile")) return response({ emailAddress: config.sender });
    if (url.pathname.endsWith("/messages/send")) { sends++; return send(init); }
    if (url.pathname.endsWith("/messages")) { assert.equal(url.searchParams.get("q"), "in:sent rfc822msgid:<decision-123@jobs.example.com>"); return response({ messages: present ? [{ id: "sent123", threadId: "thread123" }] : [] }); }
    if (url.pathname.endsWith("/messages/sent123")) return response({ id: "sent123", threadId: "thread123", labelIds: ["SENT"], payload: { headers: [{ name: "Message-ID", value: "<decision-123@jobs.example.com>" }] } });
    throw new Error("unexpected_test_request");
  };
  return { workspace: new GoogleWorkspace(config, fetcher), counts: () => ({ sends, refreshes }) };
}

test("Gmail sends RFC MIME with deterministic Message-ID and UTF-8 content", async () => {
  const f = fixture(async (init) => {
    const { raw } = JSON.parse(String(init.body));
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    assert.ok(mime.includes("Message-ID: <decision-123@jobs.example.com>\r\n"));
    assert.ok(mime.includes("Content-Transfer-Encoding: base64\r\n"));
    const decodedBody = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert.equal(decodedBody, mail.body.replace(/\n/g, "\r\n"));
    return response({ id: "sent123", threadId: "thread123" });
  });
  assert.deepEqual(await f.workspace.sendMail(mail), { id: "sent123", threadId: "thread123" });
  assert.deepEqual(f.counts(), { sends: 1, refreshes: 1 });
});

test("exact prior sent Message-ID reconciles without sending another email", async () => {
  const f = fixture(async () => assert.fail("must not send"), true);
  assert.deepEqual(await f.workspace.sendMail(mail), { id: "sent123", threadId: "thread123" });
  assert.equal(f.counts().sends, 0);
});

for (const outcome of ["network", "500", "malformed", "redirect"] as const) test(`Gmail ${outcome} outcome is uncertain and has no automatic send retry`, async () => {
  const f = fixture(async () => {
    if (outcome === "network") throw new Error("lost provider response");
    if (outcome === "500") return response({ sensitive: "provider body" }, 500);
    if (outcome === "redirect") return new Response(null, { status: 307, headers: { Location: "https://attacker.example" } });
    return new Response("not-json", { status: 200 });
  });
  await assert.rejects(() => f.workspace.sendMail(mail), (error) => error instanceof GoogleError && error.uncertain && !error.message.includes("provider body"));
  assert.equal(f.counts().sends, 1);
  // Absence from eventually indexed Gmail search never makes this error safe to resend.
  assert.equal(await f.workspace.reconcileMail(mail.messageId), null);
  assert.equal(f.counts().sends, 1);
});

test("Gmail definite validation rejection is safe to surface and does not retry", async () => {
  const f = fixture(async () => response({}, 400));
  await assert.rejects(() => f.workspace.sendMail(mail), (error) => error instanceof GoogleError && !error.uncertain && error.status === 400);
  assert.equal(f.counts().sends, 1);
});

test("Gmail refreshes after a definite 401 only, then sends once successfully", async () => {
  let attempts = 0;
  const f = fixture(async () => ++attempts === 1 ? response({}, 401) : response({ id: "sent123", threadId: "thread123" }));
  await f.workspace.sendMail(mail);
  assert.deepEqual(f.counts(), { sends: 2, refreshes: 2 });
});

test("header injection and invalid sender identity block mail before POST", async () => {
  const f = fixture(async () => assert.fail("must not send"));
  await assert.rejects(() => f.workspace.sendMail({ ...mail, subject: "subject\r\nBcc: attacker@example.com" }), /invalid_mail_subject/);
  await assert.rejects(() => f.workspace.sendMail({ ...mail, to: "candidate@example.com\r\nBcc: attacker@example.com" }), /invalid_email_address/);
  assert.deepEqual(f.counts(), { sends: 0, refreshes: 0 });
});

test("sent-mail search must verify exact Message-ID, not trust a search hit", async () => {
  const workspace = new GoogleWorkspace(config, async (input) => {
    if (String(input).includes("oauth2")) return response({ access_token: "access", token_type: "Bearer", expires_in: 3600 });
    if (String(input).includes("/messages?")) return response({ messages: [{ id: "other", threadId: "otherThread" }] });
    return response({ id: "other", threadId: "otherThread", labelIds: ["SENT"], payload: { headers: [{ name: "Message-ID", value: "<another@jobs.example.com>" }] } });
  });
  assert.equal(await workspace.reconcileMail(mail.messageId), null);
});

test("known-thread reply sync returns reference headers for exact application matching", async () => {
  const paths: string[] = [];
  const workspace = new GoogleWorkspace(config, async (input) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.hostname === "oauth2.googleapis.com") return response({ access_token: "access", token_type: "Bearer", expires_in: 3600 });
    assert.equal(url.pathname, "/gmail/v1/users/me/threads/thread123");
    return response({ messages: [{ id: "reply1", threadId: "thread123", internalDate: "1792101600000", payload: { mimeType: "text/plain", headers: [{ name: "Message-ID", value: "<reply@example.com>" }, { name: "In-Reply-To", value: "<decision-123@jobs.example.com>" }, { name: "References", value: "<decision-123@jobs.example.com>" }, { name: "From", value: "candidate@example.com" }], body: { data: Buffer.from("Thank you, confirmed").toString("base64url") } } }] });
  });
  const messages = await workspace.threadMessages("thread123");
  assert.equal(messages[0].body, "Thank you, confirmed"); assert.equal(messages[0].inReplyTo, "<decision-123@jobs.example.com>"); assert.equal(messages[0].references, "<decision-123@jobs.example.com>"); assert.equal(messages[0].sent, false);
  assert.ok(!paths.some((path) => path.endsWith("/messages")));
});
