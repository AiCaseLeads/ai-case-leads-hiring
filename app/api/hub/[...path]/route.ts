import {resolvedWorkspaceEnv} from '@/lib/workspace-config';
import { requireHubMember } from "@/lib/hub/auth";
import { handleHubRequest } from "@/lib/hub/http";
import { getHubStore } from "@/lib/hub/runtime";
import { errorResponse } from "@/lib/hiring/http";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const member = await requireHubMember(request);
    const { path } = await context.params;
    return await handleHubRequest(request, path, member, await getHubStore(request),async()=>({...await resolvedWorkspaceEnv(),ADMIN_EMAILS:process.env.ADMIN_EMAILS}));
  } catch (error) {
    return errorResponse(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;

export const DELETE = handle;
