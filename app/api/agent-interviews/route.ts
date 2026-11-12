import {getHubStore} from '@/lib/hub/runtime';
import {requestAgentInterview} from '@/lib/agent-api/interview';
import {resolvedWorkspaceEnv} from '@/lib/workspace-config';
import {jsonResponse} from '@/lib/hiring/http';
import {agentReadErrorResponse} from '@/lib/agent-api/errors';
import {readBody} from '@/lib/job-import/handler';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return jsonResponse({data:await requestAgentInterview(await getHubStore(request),request,await readBody(request),{...await resolvedWorkspaceEnv(),ADMIN_EMAILS:process.env.ADMIN_EMAILS})});}catch(error){return agentReadErrorResponse(error);}}
