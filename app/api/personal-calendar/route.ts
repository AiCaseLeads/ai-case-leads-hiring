import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { resolvedWorkspaceEnv } from "@/lib/workspace-config";
import { handlePersonalCalendar } from "@/lib/personal-calendar/http";
import { errorResponse } from "@/lib/hiring/http";
export const dynamic="force-dynamic";
async function handle(request:Request){try{const member=await requireHubMember(request),store=await getHubStore(request),env=await resolvedWorkspaceEnv();return handlePersonalCalendar(request,member,store,(process.env.ADMIN_EMAILS||"").split(","),!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_KEY));}catch(error){return errorResponse(error);}}
export const GET=handle;
export const PUT=handle;
