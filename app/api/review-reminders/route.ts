import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { workspaceEnv } from "@/lib/workspace-config";
import { errorResponse } from "@/lib/hiring/http";
import { handleReviewReminders } from "@/lib/review-reminders/http";
export const dynamic="force-dynamic";
async function handle(request:Request){
  try{
    const member=await requireHubMember(request),env=workspaceEnv() as {ADMIN_EMAILS?:string};
    return handleReviewReminders(request,member,await getHubStore(request),(env.ADMIN_EMAILS||"").split(","));
  }catch(error){return errorResponse(error);}
}
export const GET=handle;
export const PATCH=handle;
