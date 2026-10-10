import { requireHubMember } from "@/lib/hub/auth";
import { workspaceStatus } from "@/lib/workspace-config";
import { jsonResponse,errorResponse } from "@/lib/hiring/http";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{await requireHubMember(request);return jsonResponse({data:await workspaceStatus()});}catch(error){return errorResponse(error);}}
