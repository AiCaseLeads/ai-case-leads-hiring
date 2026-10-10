import { requireHubMember,requireHubAdmin } from "@/lib/hub/auth";
import { workspaceEnv } from "@/lib/workspace-config";
import { assertSameOrigin,errorResponse,jsonResponse } from "@/lib/hiring/http";
import { HiringError } from "@/lib/hiring/errors";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    const member=await requireHubMember(request);requireHubAdmin(member);assertSameOrigin(request);
    const env=workspaceEnv();if(!env.HUB_SCHEDULER_SECRET)throw new HiringError("scheduler_unavailable",503,"The scheduler secret has not been configured.");
    return jsonResponse({data:{properties:{HIRING_SITE_URL:new URL(request.url).origin,HIRING_SCHEDULER_SECRET:env.HUB_SCHEDULER_SECRET,HIRING_BATCH_LIMIT:"5"},scriptUrl:"/workspace-scheduler.gs",privateSiteRequiresServiceToken:true}});
  }catch(error){return errorResponse(error);}
}
