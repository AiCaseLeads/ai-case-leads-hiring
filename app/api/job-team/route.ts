import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { workspaceEnv } from "@/lib/workspace-config";
import { errorResponse } from "@/lib/hiring/http";
import { handleJobTeam } from "@/lib/job-team/http";
export const dynamic="force-dynamic";
async function handle(request:Request){
 try{const member=await requireHubMember(request),env=workspaceEnv() as {ADMIN_EMAILS?:string};return handleJobTeam(request,member,await getHubStore(request),(env.ADMIN_EMAILS||"").split(","));}
 catch(error){return errorResponse(error);}
}
export const GET=handle;
export const PUT=handle;
