import { railwayStaffConfig } from "@/lib/railway/auth";
import { logoutConfirmation, logoutStaff } from "@/lib/railway/auth-core";
import { errorResponse } from "@/lib/hiring/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return logoutConfirmation(request, railwayStaffConfig()); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { return await logoutStaff(request, railwayStaffConfig()); }
  catch (error) { return errorResponse(error); }
}
