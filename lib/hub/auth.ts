import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { HiringError } from "../hiring/errors";
import { railwayStaffConfig } from "../railway/auth";
import { STAFF_AUTH_PLATFORM } from "../railway/auth-config";
import { staffMemberFromRequest } from "../railway/auth-core";
import { memberFromHeaders, type HubMember, type AuthEnv } from "./auth-core";
export { memberFromHeaders, type HubMember } from "./auth-core";
function sitesConfig(): AuthEnv {
  const bindings = env as unknown as AuthEnv;
  return { ...bindings, ADMIN_EMAILS: bindings.ADMIN_EMAILS || process.env.ADMIN_EMAILS };
}
async function memberForRequest(requestHeaders: Headers): Promise<HubMember | null> {
  if (STAFF_AUTH_PLATFORM === "railway") return staffMemberFromRequest(requestHeaders, railwayStaffConfig());
  if (STAFF_AUTH_PLATFORM !== "sites") return null;
  return memberFromHeaders(requestHeaders, sitesConfig());
}
export async function getHubMember(): Promise<HubMember | null> {
  return memberForRequest(new Headers(await headers()));
}
export async function requireHubMember(request: Request): Promise<HubMember> {
  const member = await memberForRequest(request.headers);
  if (!member) throw new HiringError("staff_access_required", 403, "Sign in with an authorized hiring team account.");
  return member;
}
export function requireHubAdmin(member: HubMember): void {
  if (member.role !== "admin") throw new HiringError("admin_access_required", 403, "Only managers can change this setting.");
}
