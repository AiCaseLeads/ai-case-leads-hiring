import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { workspaceEnv } from "@/lib/workspace-config";
import { errorResponse } from "@/lib/hiring/http";
import { handleAiReview } from "@/lib/ai/http";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{
    const member=await requireHubMember(request);
    return handleAiReview(request,member,{store:await getHubStore(request),encryptionKey:workspaceEnv().GOOGLE_TOKEN_KEY,bucket:workspaceEnv().BUCKET});
  }catch(error){return errorResponse(error);}
}
