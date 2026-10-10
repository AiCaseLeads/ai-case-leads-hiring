import { sha256 } from "../hiring/crypto";

export class StaffSignInError extends Error {
  constructor(public reason: "failed" | "expired" | "not_authorized" | "unavailable") { super("Staff sign-in could not be completed."); }
}
export type GoogleStaffIdentity = { userId: string; email: string; fullName: string | null };
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
type GoogleKey = JsonWebKey & { kid: string };
const jwksCache = new WeakMap<typeof fetch, { keys: GoogleKey[]; expires: number }>();
export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new StaffSignInError("failed");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StaffSignInError("failed");
  return value as Record<string, unknown>;
}
async function providerJson(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, { ...init, redirect: "error", signal: controller.signal });
    if (!response.ok || !response.body || Number(response.headers.get("content-length") || 0) > 65_536) throw new StaffSignInError("unavailable");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.byteLength;
        if (size > 65_536) { await reader.cancel(); throw new StaffSignInError("unavailable"); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return record(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) { if (error instanceof StaffSignInError) throw error; throw new StaffSignInError("unavailable"); }
  finally { clearTimeout(timeout); }
}
async function googleKeys(fetcher: typeof fetch, now: number, force = false): Promise<GoogleKey[]> {
  const cached = jwksCache.get(fetcher);
  if (!force && cached && cached.expires > now) return cached.keys;
  const data = await providerJson(CERTS_URL, {}, fetcher);
  if (!Array.isArray(data.keys) || data.keys.length > 20) throw new StaffSignInError("unavailable");
  const keys = data.keys.filter((key): key is GoogleKey => !!key && typeof key === "object" && key.kty === "RSA" && key.alg === "RS256" && (key.use === undefined || key.use === "sig") && typeof key.kid === "string" && typeof key.n === "string" && typeof key.e === "string");
  if (!keys.length) throw new StaffSignInError("unavailable");
  jwksCache.set(fetcher, { keys, expires: now + 5 * 60_000 }); return keys;
}
export async function verifyGoogleIdentity(idToken: string, clientId: string, nonceHash: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GoogleStaffIdentity> {
  if (idToken.length > 16_384) throw new StaffSignInError("failed");
  const parts = idToken.split("."); if (parts.length !== 3) throw new StaffSignInError("failed");
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = record(JSON.parse(new TextDecoder().decode(decodeBase64(parts[0]))));
    claims = record(JSON.parse(new TextDecoder().decode(decodeBase64(parts[1]))));
  } catch { throw new StaffSignInError("failed"); }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 256 || header.crit !== undefined) throw new StaffSignInError("failed");
  let key = (await googleKeys(fetcher, now)).find(k => k.kid === header.kid);
  if (!key) key = (await googleKeys(fetcher, now, true)).find(k => k.kid === header.kid);
  if (!key) throw new StaffSignInError("failed");
  try {
    const publicKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signature = new Uint8Array(decodeBase64(parts[2]));
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature.buffer, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error("signature");
  } catch { throw new StaffSignInError("failed"); }
  // Claims are trusted only after checking Google's signature, audience, issuer,
  // expiry and the one-time nonce bound to this browser's authorization state.
  if (!["https://accounts.google.com", "accounts.google.com"].includes(String(claims.iss)) || claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId) || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now || typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat * 1000 > now + 60_000 || typeof claims.nonce !== "string" || await sha256(claims.nonce) !== nonceHash || claims.email_verified !== true || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub) || typeof claims.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) || claims.email.length > 254)
    throw new StaffSignInError("failed");
  return { userId: claims.sub, email: claims.email.trim().toLowerCase(), fullName: typeof claims.name === "string" ? claims.name.slice(0, 200) : null };
}
export async function exchangeStaffCode(input: { clientId: string; clientSecret: string; origin: string; code: string; verifier: string; nonceHash: string }, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GoogleStaffIdentity> {
  const response = await providerJson(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: `${input.origin}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: input.verifier }),
  }, fetcher);
  if (typeof response.id_token !== "string") throw new StaffSignInError("failed");
  return verifyGoogleIdentity(response.id_token, input.clientId, input.nonceHash, fetcher, now);
}
