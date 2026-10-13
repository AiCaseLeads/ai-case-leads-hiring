import { workspaceEnv } from "@/lib/workspace-config";
import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { errorResponse } from "@/lib/hiring/http";
import { handleJobSetup } from "@/lib/job-setup/http";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    return handleJobSetup(
      request,
      await requireHubMember(request),
      await getHubStore(request),
      ((workspaceEnv() as {ADMIN_EMAILS?:string}).ADMIN_EMAILS||"").split(","),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
