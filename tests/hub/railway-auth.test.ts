import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "./fixtures";
import { sha256 } from "../../lib/hiring/crypto";
import { staffAuthConfig, safeStaffReturnPath, type StaffAuthConfig } from "../../lib/railway/auth-config";
import { base64Url, verifyGoogleIdentity } from "../../lib/railway/auth-oidc";
import { completeStaffSignIn, currentStaffMember, logoutConfirmation, logoutStaff, staffCookieNames, staffMemberFromRequest, startStaffSignIn, verifiedStaffSession } from "../../lib/railway/auth-core";

const ORIGIN = "https://jobs.example.invalid", NOW = 1_791_600_000_000;
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const publicKey = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "synthetic-google-key", alg: "RS256" };
async function signedToken(nonce: string, overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const claims = { sub: "synthetic-google-sales", email: "sales@aicaseleads.com", email_verified: true, name: "Synthetic owner", iss: "https://accounts.google.com", aud: "synthetic-client", iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 3600, nonce, ...overrides };
  const input = `${base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: publicKey.kid, ...header })))}.${base64Url(new TextEncoder().encode(JSON.stringify(claims)))}`;
  return `${input}.${base64Url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input))))}`;
}
function fixture() {
  const f = createStore();
  const config = staffAuthConfig({ DB: f.db, PUBLIC_SITE_ORIGIN: ORIGIN, GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret", ADMIN_EMAILS: "sales@aicaseleads.com", NODE_ENV: "production" });
  return { ...f, config };
}
function responseCookie(response: Response, name: string): string {
  const entry = response.headers.getSetCookie().find(value => value.startsWith(`${name}=`));
  assert.ok(entry); return entry.split(";")[0];
}
async function flow(config: StaffAuthConfig, overrides: Record<string, unknown> = {}, returnTo = "/team") {
  const start = await startStaffSignIn(new Request(`${ORIGIN}/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`), config, NOW);
  const url = new URL(start.headers.get("location")!);
  const browserCookie = responseCookie(start, staffCookieNames(config).browser);
  const token = await signedToken(url.searchParams.get("nonce")!, overrides);
  let exchanges = 0;
  const fetcher = (async (input, init) => {
    if (String(input) === "https://oauth2.googleapis.com/token") {
      exchanges++;
      const values = new URLSearchParams(String(init?.body));
      assert.equal(values.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
      assert.equal(values.get("client_secret"), "synthetic-secret");
      assert.equal(base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(values.get("code_verifier")!)))), url.searchParams.get("code_challenge"));
      return Response.json({ id_token: token, access_token: "discarded-staff-only-token" });
    }
    assert.equal(String(input), "https://www.googleapis.com/oauth2/v3/certs");
    return Response.json({ keys: [publicKey] });
  }) as typeof fetch;
  const callback = (cookie = browserCookie, state = url.searchParams.get("state")!) => new Request(`${ORIGIN}/api/auth/google/callback?state=${state}&code=synthetic-code`, { headers: { Cookie: cookie } });
  return { start, url, browserCookie, fetcher, callback, exchanges: () => exchanges };
}
function addMember(f: ReturnType<typeof fixture>, email: string, role = "recruiter", active = 1) {
  f.database.prepare("INSERT INTO hub_members (id,email,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), email, role, active, NOW, NOW);
}

test("Railway rejects spoofed Sites identity, X-OpenAI headers and applicant cookies", async () => {
  const f = fixture();
  try {
    const headers = new Headers({ "oai-authenticated-user-id": "attacker", "oai-authenticated-user-email": "sales@aicaseleads.com", "X-OpenAI-User-Email": "sales@aicaseleads.com", Cookie: `hiring_session=${"a".repeat(64)}; __Host-aicl_staff_session=${"b".repeat(64)}` });
    assert.equal(await staffMemberFromRequest(headers, f.config, NOW), null);
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 0);
  } finally { f.database.close(); }
});

test("login uses trusted callback, PKCE, nonce and only identity scopes; opaque session is hash-only and secure", async () => {
  const f = fixture();
  try {
    const auth = await flow(f.config, {}, "//attacker.invalid");
    assert.equal(auth.url.searchParams.get("scope"), "openid email profile");
    assert.equal(auth.url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(auth.url.searchParams.has("client_secret"), false);
    assert.equal(auth.url.searchParams.has("access_type"), false);
    assert.match(auth.start.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax;.*Secure/);
    const response = await completeStaffSignIn(auth.callback(), f.config, auth.fetcher, NOW);
    assert.equal(response.headers.get("location"), `${ORIGIN}/team`);
    const sessionCookie = responseCookie(response, staffCookieNames(f.config).session), raw = sessionCookie.split("=")[1];
    assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax;.*Secure/);
    const row = f.database.prepare("SELECT * FROM staff_sessions").get()!;
    assert.equal(row.token_hash, await sha256(raw)); assert.notEqual(row.token_hash, raw);
    assert.equal(row.expires_at, NOW + 12 * 3600_000);
    assert.deepEqual(await staffMemberFromRequest(new Headers({ Cookie: sessionCookie }), f.config, NOW + 1), { userId: "synthetic-google-sales", email: "sales@aicaseleads.com", role: "admin", isOwner: true });
    assert.equal(await verifiedStaffSession(new Headers({ Cookie: sessionCookie }), f.config, Number(row.expires_at)), null);
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM hub_settings WHERE key LIKE 'google_%'").get()!.count, 0);
  } finally { f.database.close(); }
});

test("wrong browser does not consume OAuth state, and callback replay never exchanges another code", async () => {
  const f = fixture();
  try {
    const auth = await flow(f.config);
    const wrong = await completeStaffSignIn(auth.callback(`${staffCookieNames(f.config).browser}=${"f".repeat(64)}`), f.config, auth.fetcher, NOW);
    assert.equal(new URL(wrong.headers.get("location")!).searchParams.get("auth"), "expired");
    assert.equal(f.database.prepare("SELECT used_at FROM staff_oauth_states").get()!.used_at, null);
    const results = await Promise.all([completeStaffSignIn(auth.callback(), f.config, auth.fetcher, NOW), completeStaffSignIn(auth.callback(), f.config, auth.fetcher, NOW)]);
    assert.equal(results.filter(r => r.headers.get("location") === `${ORIGIN}/team`).length, 1);
    assert.equal(auth.exchanges(), 1); assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 1);
  } finally { f.database.close(); }
});

test("expired, missing, duplicate and error callbacks fail closed without exposing provider errors", async () => {
  const f = fixture();
  try {
    const auth = await flow(f.config);
    const cases = [new Request(`${ORIGIN}/api/auth/google/callback`), new Request(`${auth.callback().url}&state=duplicate`, { headers: auth.callback().headers }), new Request(`${auth.callback().url}&error=private-provider-details`, { headers: auth.callback().headers })];
    for (const req of cases) { const response = await completeStaffSignIn(req, f.config, auth.fetcher, NOW); assert.match(response.headers.get("location")!, /\/team\?auth=(expired|failed)$/); }
    assert.equal(auth.exchanges(), 0); assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 0);
    const second = await flow(f.config), expired = await completeStaffSignIn(second.callback(), f.config, second.fetcher, NOW + 10 * 60_000);
    assert.match(expired.headers.get("location")!, /auth=expired$/); assert.equal(second.exchanges(), 0);
  } finally { f.database.close(); }
});

test("signed Google identity must match audience, issuer, nonce, expiry, verified email and RS256 signature", async () => {
  const nonce = "synthetic-nonce", nonceHash = await sha256(nonce);
  const fetcher = (async () => Response.json({ keys: [publicKey] })) as typeof fetch;
  assert.equal((await verifyGoogleIdentity(await signedToken(nonce), "synthetic-client", nonceHash, fetcher, NOW)).email, "sales@aicaseleads.com");
  for (const overrides of [{ aud: "other-client" }, { azp: "other-client" }, { iss: "https://attacker.invalid" }, { nonce: "wrong-nonce" }, { exp: NOW / 1000 }, { exp: "tomorrow" }, { iat: NOW / 1000 + 120 }, { email_verified: false }, { email_verified: "true" }, { sub: "" }]) await assert.rejects(verifyGoogleIdentity(await signedToken(nonce, overrides), "synthetic-client", nonceHash, fetcher, NOW));
  const token = await signedToken(nonce), parts = token.split(".");
  const altered = `${parts[0]}.${base64Url(new TextEncoder().encode(JSON.stringify({ email: "sales@aicaseleads.com" })))}.${parts[2]}`;
  await assert.rejects(verifyGoogleIdentity(altered, "synthetic-client", nonceHash, fetcher, NOW));
  await assert.rejects(verifyGoogleIdentity(await signedToken(nonce, {}, { alg: "none" }), "synthetic-client", nonceHash, fetcher, NOW));
});

test("unknown and revoked accounts cannot sign in; no first-user administrator or inherited mailbox scopes", async () => {
  for (const revoked of [false, true]) {
    const f = fixture();
    try {
      if (revoked) addMember(f, "unknown@example.invalid", "recruiter", 0);
      const auth = await flow(f.config, { email: "unknown@example.invalid", sub: "synthetic-unknown" });
      const response = await completeStaffSignIn(auth.callback(), f.config, auth.fetcher, NOW);
      assert.match(response.headers.get("location")!, /auth=not_authorized$/);
      assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 0);
      assert.equal(f.database.prepare("SELECT COUNT(*) count FROM hub_members WHERE active=1").get()!.count, 0);
    } finally { f.database.close(); }
  }
});

test("each session request rechecks current role and revocation, including explicit owner revocation", async () => {
  const f = fixture();
  try {
    addMember(f, "staff@example.invalid", "recruiter");
    const auth = await flow(f.config, { email: "staff@example.invalid", sub: "synthetic-staff" });
    const response = await completeStaffSignIn(auth.callback(), f.config, auth.fetcher, NOW), headers = new Headers({ Cookie: responseCookie(response, staffCookieNames(f.config).session) });
    assert.equal((await staffMemberFromRequest(headers, f.config, NOW))?.role, "recruiter");
    f.database.prepare("UPDATE hub_members SET role='admin' WHERE email='staff@example.invalid'").run();
    assert.equal((await staffMemberFromRequest(headers, f.config, NOW))?.role, "admin");
    f.database.prepare("UPDATE hub_members SET active=0 WHERE email='staff@example.invalid'").run();
    assert.equal(await staffMemberFromRequest(headers, f.config, NOW), null);
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 0);
    addMember(f, "sales@aicaseleads.com", "admin", 0);
    assert.equal(await currentStaffMember({ userId: "sales-sub", email: "sales@aicaseleads.com", fullName: null }, f.config), null);
  } finally { f.database.close(); }
});

test("logout is an explicit POST with trusted-origin CSRF protection; GET does not change sessions", async () => {
  const f = fixture();
  try {
    const auth = await flow(f.config), signedIn = await completeStaffSignIn(auth.callback(), f.config, auth.fetcher, NOW), session = responseCookie(signedIn, staffCookieNames(f.config).session);
    const get = new Request(`${ORIGIN}/api/auth/logout?return_to=//attacker.invalid`, { headers: { Cookie: session } });
    assert.match(await logoutConfirmation(get, f.config).text(), /method="post"/);
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 1);
    const invalidHeaders: Record<string, string>[] = [{ Cookie: session }, { Cookie: session, Origin: "https://attacker.invalid" }, { Cookie: session, Origin: ORIGIN, "sec-fetch-site": "cross-site" }];
    for (const headers of invalidHeaders) await assert.rejects(logoutStaff(new Request(get.url, { method: "POST", headers }), f.config), { code: "invalid_origin" });
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 1);
    const response = await logoutStaff(new Request(get.url, { method: "POST", headers: { Cookie: session, Origin: ORIGIN } }), f.config);
    assert.equal(response.headers.get("location"), `${ORIGIN}/team`); assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 0);
  } finally { f.database.close(); }
});

test("auth configuration and return paths cannot use untrusted hosts or insecure production cookies", () => {
  const f = fixture();
  try {
    for (const value of ["https://user:secret@jobs.invalid", "https://jobs.invalid/prefix", "http://jobs.invalid", "http://localhost:5173", "https://jobs.invalid?query=1"]) assert.throws(() => staffAuthConfig({ DB: f.db, PUBLIC_SITE_ORIGIN: value, NODE_ENV: "production" }));
    assert.equal(staffAuthConfig({ DB: f.db, PUBLIC_SITE_ORIGIN: "http://127.0.0.1:5173", NODE_ENV: "development" }).secureCookies, false);
    for (const value of ["//evil.invalid", "https://evil.invalid", "/\\evil.invalid", "/api/auth/google/start", "/signout-with-chatgpt", "/team\nLocation:x"]) assert.equal(safeStaffReturnPath(value), "/team");
    assert.equal(safeStaffReturnPath("/team?tab=candidates#detail"), "/team?tab=candidates#detail");
  } finally { f.database.close(); }
});

test("provider outages, oversized responses and invalid signatures never issue sessions", async () => {
  for (const response of [new Response("provider-secret-detail", { status: 500 }), new Response("a".repeat(65_537))]) {
    const f = fixture();
    try {
      const auth = await flow(f.config), unavailable = await completeStaffSignIn(auth.callback(), f.config, (async () => response) as typeof fetch, NOW);
      assert.match(unavailable.headers.get("location")!, /auth=unavailable$/);
      assert.equal(f.database.prepare("SELECT COUNT(*) count FROM staff_sessions").get()!.count, 0);
    } finally { f.database.close(); }
  }
});
