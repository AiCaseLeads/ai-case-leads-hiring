import { HiringError } from "../hiring/errors";

export type StaffAuthBindings = {
  DB?: D1Database;
  PUBLIC_SITE_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAILS?: string;
  NODE_ENV?: string;
};
export type StaffAuthConfig = {
  db: D1Database;
  origin: string;
  secureCookies: boolean;
  clientId?: string;
  clientSecret?: string;
  adminEmails: string;
};
// Captured once from server configuration. Requests cannot select an auth provider.
// Railway startup sets this before importing the SSR bundle; native Railway env is
// a fail-closed safety net. Only the legacy Sites runtime uses dispatcher headers.
const hostingPlatform = process.env.HOSTING_PLATFORM;
export const STAFF_AUTH_PLATFORM = hostingPlatform === "railway" || !!process.env.RAILWAY_PROJECT_ID
  ? "railway" : hostingPlatform === undefined || hostingPlatform === "sites" ? "sites" : "invalid";
export function usesGoogleStaffAuth(): boolean { return STAFF_AUTH_PLATFORM !== "sites"; }
export function staffAuthConfig(bindings: StaffAuthBindings): StaffAuthConfig {
  if (!bindings.DB) throw new HiringError("staff_auth_unavailable", 503, "Staff sign-in is not configured yet.");
  let url: URL;
  try { url = new URL(bindings.PUBLIC_SITE_ORIGIN || ""); }
  catch { throw new HiringError("staff_auth_unavailable", 503, "Staff sign-in is not configured yet."); }
  const secureCookies = url.protocol === "https:";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!secureCookies && !(url.protocol === "http:" && local && bindings.NODE_ENV !== "production")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new HiringError("staff_auth_unavailable", 503, "Staff sign-in is not configured yet.");
  return { db: bindings.DB, origin: url.origin, secureCookies, clientId: bindings.GOOGLE_CLIENT_ID, clientSecret: bindings.GOOGLE_CLIENT_SECRET, adminEmails: bindings.ADMIN_EMAILS || "" };
}
export function safeStaffReturnPath(value: string | null | undefined, fallback = "/team"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n\u0000]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://staff.local");
    if (url.origin !== "https://staff.local" || url.pathname.startsWith("/api/auth/") || ["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}
