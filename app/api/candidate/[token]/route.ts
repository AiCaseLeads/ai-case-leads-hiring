import { personalCalendarClient } from "@/lib/personal-calendar/client";
import { getHubStore } from "@/lib/hub/runtime";
import { handleCandidateRequest } from "@/lib/hub/candidate";
import { workspaceClient,workspaceStatus,resolvedWorkspaceEnv } from "@/lib/workspace-config";
import { errorResponse } from "@/lib/hiring/http";
export const dynamic="force-dynamic";
async function handle(request:Request,context:{params:Promise<{token:string}>}){
  try{
    const {token}=await context.params,store=await getHubStore(request),status=await workspaceStatus();
    const google=status.connected&&status.calendarId?await workspaceClient():null;
    return handleCandidateRequest(request,token,store,{...(google?{busy:input=>google.busy(input)}:{}),personalBusy:async(snapshot,input)=>(await personalCalendarClient(store,snapshot,await resolvedWorkspaceEnv())).busy(input)});
  }catch(error){return errorResponse(error);}
}
export const GET=handle;
export const POST=handle;
