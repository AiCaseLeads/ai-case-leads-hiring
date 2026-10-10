import test from "node:test";
import assert from "node:assert/strict";
import { authorizationUrl, exchangeCode, GOOGLE_SCOPES, openToken, refreshAccessToken, scopeStatus, sealToken } from "../../lib/google/workspace";

function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const key = "a9".repeat(32);

test("OAuth URL binds state, offline consent, exact callback and PKCE; rejects unsafe redirect", () => {
  const url = new URL(authorizationUrl({ clientId: "client", redirectUri: "https://jobs.example.com/api/google/callback", state: "state_".repeat(8), codeChallenge: "x".repeat(43) }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state_".repeat(8));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.throws(() => authorizationUrl({ clientId: "client", redirectUri: "https://user:password@jobs.example.com/callback", state: "x".repeat(32) }), /invalid_oauth_redirect_uri/);
  assert.throws(() => authorizationUrl({ clientId: "client", redirectUri: "http://attacker.example/callback", state: "x".repeat(32) }), /invalid_oauth_redirect_uri/);
});

test("OAuth code exchange posts only to Google and returns actual mailbox identity with grants", async () => {
  let tokenCalls = 0;
  const result = await exchangeCode({ clientId: "client", clientSecret: "private-secret", redirectUri: "https://jobs.example.com/api/google/callback", code: "code", codeVerifier: "v".repeat(43) }, async (input, init = {}) => {
    assert.equal(init.redirect, "manual");
    if (String(input) === "https://oauth2.googleapis.com/token") {
      tokenCalls++;
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code_verifier"), "v".repeat(43));
      return response({ access_token: "access", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600, scope: GOOGLE_SCOPES.join(" ") });
    }
    assert.equal(String(input), "https://gmail.googleapis.com/gmail/v1/users/me/profile");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer access");
    return response({ emailAddress: "Recruiting@Example.com" });
  });
  assert.equal(tokenCalls, 1); assert.equal(result.email, "recruiting@example.com");
  assert.equal(result.refreshToken, "refresh"); assert.deepEqual(scopeStatus(result.scope), { mail: true, calendar: true, drive: true });
});

test("partial consent cannot be presented as a working Workspace connection", async () => {
  let calls = 0;
  await assert.rejects(() => exchangeCode({ clientId: "client", clientSecret: "secret", redirectUri: "https://jobs.example.com/api/google/callback", code: "code" }, async () => {
    calls++; return response({ access_token: "access", token_type: "Bearer", expires_in: 3600, scope: GOOGLE_SCOPES[1] });
  }), /google_required_permissions_missing/);
  assert.equal(calls, 1);
});

test("refresh rejects redirected token endpoint without following it or exposing response data", async () => {
  let calls = 0;
  await assert.rejects(() => refreshAccessToken({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" }, async (_input, init) => {
    calls++; assert.equal(init?.redirect, "manual"); return new Response(null, { status: 302, headers: { Location: "https://attacker.example/secret" } });
  }), /google_redirect_rejected/);
  assert.equal(calls, 1);
});

test("sealed tokens use randomized authenticated encryption and detect tampering or wrong keys", async () => {
  const first = await sealToken("private-refresh-token", key), second = await sealToken("private-refresh-token", key);
  assert.notEqual(first, second); assert.ok(!first.includes("private-refresh-token"));
  assert.equal(await openToken(first, key), "private-refresh-token");
  await assert.rejects(() => openToken(first, "b4".repeat(32)), /google_sealed_token_invalid/);
  const parts = first.split("."); parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  await assert.rejects(() => openToken(parts.join("."), key), /google_sealed_token_invalid/);
  await assert.rejects(() => sealToken("refresh", "password"), /32_random_bytes_hex/);
});
