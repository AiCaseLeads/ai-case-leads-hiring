import {getHubStore} from '@/lib/hub/runtime';
import {rejectApplicant} from '@/lib/agent-api/reject';
import {jsonResponse} from '@/lib/hiring/http';
import {agentReadErrorResponse} from '@/lib/agent-api/errors';
import {readBody} from '@/lib/job-import/handler';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return jsonResponse({data:await rejectApplicant(await getHubStore(request),request,await readBody(request))});}catch(error){return agentReadErrorResponse(error);}}
