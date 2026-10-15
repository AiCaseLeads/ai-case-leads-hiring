import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { errorResponse } from "@/lib/hiring/http";
import { handleJobDrafts } from "@/lib/job-setup/drafts";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    return await handleJobDrafts(
      request,
      await requireHubMember(request),
      await getHubStore(request),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
