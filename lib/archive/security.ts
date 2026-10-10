export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyAshbySignature(raw: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const digest = Uint8Array.from(signature.slice(7).match(/../g)!, (b) => parseInt(b, 16));
  return crypto.subtle.verify("HMAC", key, digest, raw as BufferSource);
}

export async function internalAuthorized(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 2048) return false;
  const a = await sha256(header.slice(7));
  const b = await sha256(secret);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function requireId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("invalid_provider_id");
  return value;
}

export function safeDownloadUrl(value: string, allowedHosts: string[]): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || host === "localhost" || /\.(local|localhost|internal)$/.test(host) || !allowedHosts.some((h) => h.toLowerCase() === host)) {
    throw new Error("download_host_not_allowed");
  }
  return url;
}

export function safeDriveSession(value: string): string {
  const url = new URL(value);
  if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/upload/drive/v3/files") || url.username || url.password) throw new Error("invalid_drive_session");
  return url.toString();
}

export function safeError(error: unknown): string {
  // Provider URLs, bodies, emails, and tokens never enter status rows or logs.
  const message = error instanceof Error ? error.message : "archive_failed";
  return /^[a-z0-9_.:-]{1,100}$/i.test(message) ? message : "archive_failed";
}
