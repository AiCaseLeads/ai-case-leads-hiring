import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { workspaceEnv,workspaceClient,workspaceStatus } from "@/lib/workspace-config";
import { processHubTasks,schedulerAuthorized } from "@/lib/task-runner";
import { assertSameOrigin,errorResponse,jsonResponse } from "@/lib/hiring/http";
import { boundedBytes } from "@/lib/hiring/files";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    const env=workspaceEnv();
    if(!await schedulerAuthorized(request,env.HUB_SCHEDULER_SECRET)){await requireHubMember(request);assertSameOrigin(request);}
    let limit=5;
    if(request.body){const bytes=await boundedBytes(request,16384);if(bytes.length){const body=JSON.parse(new TextDecoder().decode(bytes));if(Number.isInteger(body.limit))limit=Math.max(1,Math.min(body.limit,10));}}
    const status=await workspaceStatus(env);
    const store=await getHubStore(request);
    const result=await processHubTasks(store,env.DB!,env.BUCKET,status.connected?await workspaceClient(env):undefined,limit);
    return jsonResponse({data:{configured:true,...result}});
  }catch(error){return errorResponse(error);}
}
