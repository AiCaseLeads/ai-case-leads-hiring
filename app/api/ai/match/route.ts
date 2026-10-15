import { requireHubMember } from '@/lib/hub/auth';
import { getHubStore } from '@/lib/hub/runtime';
import { workspaceEnv } from '@/lib/workspace-config';
import { errorResponse } from '@/lib/hiring/http';
import { handleAiMatch } from '@/lib/ai/match-http';
export const dynamic='force-dynamic';
async function handle(request:Request){
 try{return handleAiMatch(request,await requireHubMember(request),{store:await getHubStore(request),encryptionKey:workspaceEnv().GOOGLE_TOKEN_KEY,bucket:workspaceEnv().BUCKET});}
 catch(error){return errorResponse(error);}
}
export const GET=handle;export const PATCH=handle;export const POST=handle;
