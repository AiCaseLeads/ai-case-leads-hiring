import { env } from "cloudflare:workers";
import { HiringError } from "../hiring/errors";
import { STAFF_AUTH_PLATFORM, staffAuthConfig, type StaffAuthBindings } from "./auth-config";

export function railwayStaffConfig() {
  if (STAFF_AUTH_PLATFORM !== "railway") throw new HiringError("staff_auth_unavailable", 503, "Google staff sign-in is not available here.");
  return staffAuthConfig({ ...process.env, ...env } as StaffAuthBindings);
}
