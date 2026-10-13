import { privateToken, sha256 } from "../hiring/crypto";
import { HiringError } from "../hiring/errors";
import type { HubMember } from "../hub/auth-core";
import { safeStaffReturnPath, type StaffAuthConfig } from "./auth-config";
import { base64Url, exchangeStaffCode, StaffSignInError, type GoogleStaffIdentity } from "./auth-oidc";

const TOKEN = /^[a-f0-9]{64}$/;
const STATE_TTL = 10 * 60_000;
const SESSION_TTL = 12 * 60 * 60_000;
export function staffCookieNames(config: StaffAuthConfig) {
  return { session: config.secureCookies ? "__Host-aicl_staff_session" : "aicl_staff_session", browser: config.secureCookies ? "__Host-aicl_staff_oauth" : "aicl_staff_oauth" };
}
function cookie(headers: Headers, name: string): string | null {
  const matches = (headers.get("cookie") || "").split(";").map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1); return TOKEN.test(value) ? value : null;
}
function setCookie(config: StaffAuthConfig, name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
}
function redirectTo(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
function requestOnSite(request: Request, config: StaffAuthConfig): void {
  if (new URL(request.url).origin !== config.origin) throw new StaffSignInError("failed");
}
function requireGoogle(config: StaffAuthConfig): asserts config is StaffAuthConfig & { clientId: string; clientSecret: string } {
  if (!config.clientId || !config.clientSecret) throw new StaffSignInError("unavailable");
}
export async function currentStaffMember(identity: GoogleStaffIdentity, config: StaffAuthConfig): Promise<HubMember | null> {
  const row = await config.db.prepare("SELECT role,active FROM hub_members WHERE email=?").bind(identity.email).first<{ role: string; active: number }>();
  // An explicit revoked membership overrides the owner environment allowlist.
  if (row && (!row.active || !["admin", "recruiter"].includes(row.role))) return null;
  const owners = config.adminEmails.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (owners.includes(identity.email)) return { userId: identity.userId, email: identity.email, role: "admin", isOwner: true };
  if (!row) return null;
  return { userId: identity.userId, email: identity.email, role: row.role as HubMember["role"], isOwner: false };
}
export async function verifiedStaffSession(headers: Headers, config: StaffAuthConfig, now = Date.now()): Promise<{ identity: GoogleStaffIdentity; member: HubMember } | null> {
  const token = cookie(headers, staffCookieNames(config).session); if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await config.db.prepare("SELECT user_id,email,full_name FROM staff_sessions WHERE token_hash=? AND expires_at>?").bind(tokenHash, now).first<{ user_id: string; email: string; full_name: string | null }>();
  if (!row) return null;
  const identity = { userId: row.user_id, email: row.email, fullName: row.full_name };
  const member = await currentStaffMember(identity, config);
  if (!member) { await config.db.prepare("DELETE FROM staff_sessions WHERE token_hash=?").bind(tokenHash).run(); return null; }
  return { identity, member };
}
// Request headers are not an identity source here. Only a server-issued opaque
// cookie whose hash exists in the private database can reach current membership.
export async function staffMemberFromRequest(headers: Headers, config: StaffAuthConfig, now = Date.now()): Promise<HubMember | null> {
  return (await verifiedStaffSession(headers, config, now))?.member || null;
}
export async function startStaffSignIn(request: Request, config: StaffAuthConfig, now = Date.now()): Promise<Response> {
  try {
    requestOnSite(request, config); requireGoogle(config);
    const url = new URL(request.url), names = staffCookieNames(config);
    const browser = cookie(request.headers, names.browser) || privateToken();
    const bucket = Math.floor(now / STATE_TTL), limitKey = await sha256("staff-auth:starts");
    const rate = await config.db.prepare("INSERT INTO hiring_rate_limits (key_hash,window,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(limitKey, bucket).first<{ attempts: number }>();
    if (!rate || rate.attempts > 1000) throw new StaffSignInError("unavailable");
    await config.db.prepare("DELETE FROM staff_oauth_states WHERE expires_at<=?").bind(now).run();
    await config.db.prepare("DELETE FROM staff_sessions WHERE expires_at<=?").bind(now).run();
    const state = privateToken(), verifier = privateToken(), nonce = privateToken();
    await config.db.prepare("INSERT INTO staff_oauth_states (state_hash,browser_hash,verifier,nonce_hash,return_to,expires_at,used_at) VALUES (?,?,?,?,?,?,NULL)").bind(await sha256(state), await sha256(browser), verifier, await sha256(nonce), safeStaffReturnPath(url.searchParams.get("return_to")), now + STATE_TTL).run();
    const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.origin}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", prompt: "select_account", state, nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    const response = redirectTo(authorization.toString());
    response.headers.append("Set-Cookie", setCookie(config, names.browser, browser, STATE_TTL / 1000)); return response;
  } catch { return redirectTo(`${config.origin}/team?auth=unavailable`); }
}
export async function completeStaffSignIn(request: Request, config: StaffAuthConfig, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  let response: Response;
  try {
    requestOnSite(request, config); requireGoogle(config);
    const query = new URL(request.url).searchParams, state = query.get("state"), code = query.get("code");
    const browser = cookie(request.headers, staffCookieNames(config).browser);
    if (!state || !TOKEN.test(state) || !browser || query.getAll("state").length !== 1 || query.getAll("code").length > 1 || query.getAll("error").length > 1 || (code && (code.length > 4096 || /[\u0000-\u001f]/.test(code)))) throw new StaffSignInError("expired");
    // Browser matching and one-use consumption happen in the same atomic write.
    // A mismatched browser cannot invalidate another user's authorization state.
    const claimed = await config.db.prepare("UPDATE staff_oauth_states SET used_at=? WHERE state_hash=? AND browser_hash=? AND used_at IS NULL AND expires_at>? RETURNING verifier,nonce_hash,return_to").bind(now, await sha256(state), await sha256(browser), now).first<{ verifier: string; nonce_hash: string; return_to: string }>();
    if (!claimed) throw new StaffSignInError("expired");
    if (query.has("error") || !code) throw new StaffSignInError("failed");
    const identity = await exchangeStaffCode({ clientId: config.clientId, clientSecret: config.clientSecret, origin: config.origin, code, verifier: claimed.verifier, nonceHash: claimed.nonce_hash }, fetcher, now);
    if (!await currentStaffMember(identity, config)) throw new StaffSignInError("not_authorized");
    const old = cookie(request.headers, staffCookieNames(config).session);
    const token = privateToken();
    const writes = [config.db.prepare("INSERT INTO staff_sessions (token_hash,user_id,email,full_name,created_at,expires_at) VALUES (?,?,?,?,?,?)").bind(await sha256(token), identity.userId, identity.email, identity.fullName, now, now + SESSION_TTL)];
    if (old) writes.push(config.db.prepare("DELETE FROM staff_sessions WHERE token_hash=?").bind(await sha256(old)));
    await config.db.batch(writes);
    response = redirectTo(`${config.origin}${safeStaffReturnPath(claimed.return_to)}`);
    response.headers.append("Set-Cookie", setCookie(config, staffCookieNames(config).session, token, SESSION_TTL / 1000));
  } catch (error) {
    const reason = error instanceof StaffSignInError ? error.reason : "unavailable";
    response = redirectTo(`${config.origin}/team?auth=${reason}`);
  }
  response.headers.append("Set-Cookie", setCookie(config, staffCookieNames(config).browser, "", 0)); return response;
}
export async function logoutStaff(request: Request, config: StaffAuthConfig): Promise<Response> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.method !== "POST" || request.headers.get("origin") !== config.origin || new URL(request.url).origin !== config.origin || (fetchSite && !["same-origin", "none"].includes(fetchSite))) throw new HiringError("invalid_origin", 403, "Open your hiring workspace before signing out.");
  const names = staffCookieNames(config), token = cookie(request.headers, names.session);
  if (token) await config.db.prepare("DELETE FROM staff_sessions WHERE token_hash=?").bind(await sha256(token)).run();
  const response = redirectTo(`${config.origin}${safeStaffReturnPath(new URL(request.url).searchParams.get("return_to"))}`);
  response.headers.append("Set-Cookie", setCookie(config, names.session, "", 0));
  response.headers.append("Set-Cookie", setCookie(config, names.browser, "", 0)); return response;
}
export function logoutConfirmation(request: Request, config: StaffAuthConfig): Response {
  requestOnSite(request, config);
  const returnTo = encodeURIComponent(safeStaffReturnPath(new URL(request.url).searchParams.get("return_to")));
  // The query is encoded and no account/session values are placed in markup.
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign out | AI Case Leads</title><body><main><h1>Sign out of the hiring workspace?</h1><form method="post" action="/api/auth/logout?return_to=${returnTo}"><button type="submit">Sign out</button></form><p><a href="/team">Stay signed in</a></p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}
