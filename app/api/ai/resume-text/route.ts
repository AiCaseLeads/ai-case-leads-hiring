import { requireHubMember } from "@/lib/hub/auth";
import { getHubStore } from "@/lib/hub/runtime";
import { workspaceEnv } from "@/lib/workspace-config";
import { errorResponse } from "@/lib/hiring/http";
import { handleResumeText } from "@/lib/pdf/http";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  try{return handleResumeText(request,await requireHubMember(request),{store:await getHubStore(request),bucket:workspaceEnv().BUCKET});}
  catch(error){return errorResponse(error);}
}
