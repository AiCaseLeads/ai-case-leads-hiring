import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { workspaceEnv } from "@/lib/workspace-config";
import { errorResponse } from "@/lib/hiring/http";
import { handleAiConfig } from "@/lib/ai/http";
export const dynamic="force-dynamic";
async function handle(request:Request){
  try{
    const member=await requireHubMember(request);
    return handleAiConfig(request,member,{store:await getHubStore(request),encryptionKey:workspaceEnv().GOOGLE_TOKEN_KEY});
  }catch(error){return errorResponse(error);}
}
export const GET=handle;
export const PATCH=handle;
