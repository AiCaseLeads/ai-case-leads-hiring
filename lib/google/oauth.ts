import { base64url, emailAddress, fromBase64url, googleFetch, GoogleError, json, utf8 } from "./http";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  // A user-configured existing Drive root is not accessible with drive.file without Google Picker.
  "https://www.googleapis.com/auth/drive",
] as const;
export const PERSONAL_CALENDAR_SCOPES=["https://www.googleapis.com/auth/calendar.events","https://www.googleapis.com/auth/calendar.freebusy","https://www.googleapis.com/auth/userinfo.email"] as const;
export interface OAuthClient { clientId: string; clientSecret: string }
export interface OAuthTokens { accessToken: string; refreshToken?: string; expiresIn: number; scope: string; refreshTokenExpiresIn?: number }

function redirectUri(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new GoogleError("invalid_oauth_redirect_uri");
  return url.toString();
}
export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string; loginHint?: string; scopes?: readonly string[]; codeChallenge?: string }): string {
  if (!input.clientId || !/^[A-Za-z0-9_-]{32,256}$/.test(input.state)) throw new GoogleError("invalid_oauth_configuration");
  const scopes = input.scopes ?? GOOGLE_SCOPES;
  if (!scopes.length || scopes.some((scope) => !/^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._]+$/.test(scope))) throw new GoogleError("invalid_oauth_scopes");
  const params = new URLSearchParams({ client_id: input.clientId, redirect_uri: redirectUri(input.redirectUri), response_type: "code", scope: scopes.join(" "), access_type: "offline", include_granted_scopes: "true", prompt: "consent select_account", state: input.state });
  if (input.loginHint) params.set("login_hint", emailAddress(input.loginHint));
  if (input.codeChallenge) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) throw new GoogleError("invalid_pkce_challenge");
    params.set("code_challenge", input.codeChallenge); params.set("code_challenge_method", "S256");
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(values: Record<string, string>, fetcher: typeof fetch): Promise<OAuthTokens> {
  const response = await googleFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) }, fetcher);
  if (!response.ok) throw new GoogleError("google_oauth_reconnect_required", response.status);
  const data = await json<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string; refresh_token_expires_in?: number }>(response);
  if (!data.access_token || data.token_type?.toLowerCase() !== "bearer" || typeof data.expires_in !== "number" || data.expires_in <= 0) throw new GoogleError("google_oauth_response_invalid");
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, scope: data.scope ?? "", refreshTokenExpiresIn: data.refresh_token_expires_in };
}
export async function exchangeCode(input: OAuthClient & { redirectUri: string; code: string; codeVerifier?: string }, fetcher: typeof fetch = fetch): Promise<OAuthTokens & { email: string }> {
  if (!input.clientId || !input.clientSecret || !input.code || input.code.length > 4096) throw new GoogleError("invalid_oauth_configuration");
  if (input.codeVerifier && !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new GoogleError("invalid_pkce_verifier");
  const tokens = await tokenRequest({ client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: redirectUri(input.redirectUri), code: input.code, grant_type: "authorization_code", ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}) }, fetcher);
  if (!tokens.scope.split(" ").includes("https://www.googleapis.com/auth/gmail.readonly")) throw new GoogleError("google_mail_read_permission_required");
  if (Object.values(scopeStatus(tokens.scope)).some((granted) => !granted)) throw new GoogleError("google_required_permissions_missing");
  const profile = await accountProfile(tokens.accessToken, fetcher);
  return { ...tokens, email: profile.email };
}
/** Calendar consent uses verified identity, never Gmail profile/read permissions. */
export async function exchangeCalendarCode(input:OAuthClient&{redirectUri:string;code:string;codeVerifier:string},fetcher:typeof fetch=fetch):Promise<OAuthTokens&{email:string}>{
 if(!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)||!input.code||input.code.length>4096)throw new GoogleError("invalid_oauth_configuration");
 const tokens=await tokenRequest({client_id:input.clientId,client_secret:input.clientSecret,redirect_uri:redirectUri(input.redirectUri),code:input.code,grant_type:"authorization_code",code_verifier:input.codeVerifier},fetcher);
 const scopes=new Set(tokens.scope.split(" "));
 if(PERSONAL_CALENDAR_SCOPES.some(scope=>!scopes.has(scope)))throw new GoogleError("missing_permissions");
 const response=await googleFetch("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:`Bearer ${tokens.accessToken}`}},fetcher);
 if(!response.ok)throw new GoogleError("google_profile_unavailable",response.status);
 const profile=await json<{email?:string;verified_email?:boolean}>(response);
 if(!profile.email||profile.verified_email!==true)throw new GoogleError("google_profile_invalid");
 return {...tokens,email:emailAddress(profile.email).toLowerCase()};
}
export async function refreshAccessToken(input: OAuthClient & { refreshToken: string }, fetcher: typeof fetch = fetch): Promise<OAuthTokens> {
  if (!input.clientId || !input.clientSecret || !input.refreshToken) throw new GoogleError("google_not_connected");
  return tokenRequest({ client_id: input.clientId, client_secret: input.clientSecret, refresh_token: input.refreshToken, grant_type: "refresh_token" }, fetcher);
}
export async function accountProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<{ email: string }> {
  const response = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher);
  if (!response.ok) throw new GoogleError("google_profile_unavailable", response.status);
  const data = await json<{ emailAddress?: string }>(response);
  if (!data.emailAddress) throw new GoogleError("google_profile_invalid");
  return { email: emailAddress(data.emailAddress).toLowerCase() };
}
export function scopeStatus(scope: string) {
  const granted = new Set(scope.split(" "));
  return { mail: granted.has(GOOGLE_SCOPES[0]) && granted.has(GOOGLE_SCOPES[1]), calendar: granted.has(GOOGLE_SCOPES[2]) && granted.has(GOOGLE_SCOPES[3]), drive: granted.has(GOOGLE_SCOPES[4]) };
}

async function sealingKey(value: string): Promise<CryptoKey> {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new GoogleError("google_token_key_must_be_32_random_bytes_hex");
  const bytes = Uint8Array.from(value.match(/../g)!, (v) => parseInt(v, 16));
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const TOKEN_CONTEXT = new Uint8Array(utf8("aicaseleads:google-refresh-token:v1")).buffer;
export async function sealToken(token: string, key: string): Promise<string> {
  if (!token || token.length > 8192) throw new GoogleError("google_refresh_token_invalid");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: TOKEN_CONTEXT, tagLength: 128 }, await sealingKey(key), new Uint8Array(utf8(token)).buffer);
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
export async function openToken(sealed: string, key: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || sealed.length > 12000) throw new GoogleError("google_sealed_token_invalid");
  try {
    const iv = new Uint8Array(fromBase64url(parts[1]));
    if (iv.length !== 12) throw new Error("iv");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: TOKEN_CONTEXT, tagLength: 128 }, await sealingKey(key), new Uint8Array(fromBase64url(parts[2])).buffer);
    const token = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    if (!token) throw new Error("empty");
    return token;
  } catch { throw new GoogleError("google_sealed_token_invalid"); }
}
export const seal = sealToken;
