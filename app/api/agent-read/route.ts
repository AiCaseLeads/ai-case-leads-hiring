import {getHubStore} from '@/lib/hub/runtime';
import {workspaceEnv} from '@/lib/workspace-config';
import {handleAgentRead} from '@/lib/agent-api/read';
import {errorResponse} from '@/lib/hiring/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{return await handleAgentRead(request,await getHubStore(request),workspaceEnv().BUCKET);}catch(error){return errorResponse(error)}}
