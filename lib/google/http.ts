/** Deliberately does not retry writes. The durable hub decides when it is safe to retry. */
export class GoogleError extends Error {
  constructor(public code: string, public status = 0, public uncertain = false) {
    super(code); this.name = "GoogleError";
  }
}

const ORIGINS = new Set(["https://oauth2.googleapis.com", "https://gmail.googleapis.com", "https://www.googleapis.com"]);
export async function googleFetch(url: string, init: RequestInit, fetcher: typeof fetch, ambiguousWrite = false): Promise<Response> {
  const parsed = new URL(url);
  if (!ORIGINS.has(parsed.origin) || parsed.username || parsed.password) throw new GoogleError("invalid_google_url");
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) }); }
  catch (error) { if (error instanceof GoogleError && error.code === "processor_deadline_exceeded") throw error; throw new GoogleError("google_network_error", 0, ambiguousWrite); }
  // No redirect may carry an OAuth token or candidate data to another origin.
  if (response.status >= 300 && response.status < 400) throw new GoogleError("google_redirect_rejected", response.status, ambiguousWrite);
  if (!response.ok && response.status !== 401) throw new GoogleError("google_api_error", response.status, ambiguousWrite && (response.status >= 500 || response.status === 408));
  return response;
}

export async function json<T>(response: Response, uncertain = false, maxBytes = 2 * 1024 * 1024): Promise<T> {
  try {
    if (!response.body) throw new Error("empty");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("too_large"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  catch { throw new GoogleError("google_response_invalid", response.status, uncertain); }
}

export function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
export function base64(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}
export function base64url(bytes: Uint8Array): string { return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
export function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw new GoogleError("invalid_base64url");
  try { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (c) => c.charCodeAt(0)); }
  catch { throw new GoogleError("invalid_base64url"); }
}
export async function hash(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? utf8(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export function emailAddress(value: string): string {
  if (value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value) || value.includes("..")) throw new GoogleError("invalid_email_address");
  return value;
}
