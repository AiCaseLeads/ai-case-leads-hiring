import { railwayStaffConfig } from "@/lib/railway/auth";
import { completeStaffSignIn } from "@/lib/railway/auth-core";
import { errorResponse } from "@/lib/hiring/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return await completeStaffSignIn(request, railwayStaffConfig()); }
  catch (error) { return errorResponse(error); }
}
