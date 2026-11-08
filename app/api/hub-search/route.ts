import { requireHubMember } from '@/lib/hub/auth';
import { getHubStore } from '@/lib/hub/runtime';
import { errorResponse,jsonResponse } from '@/lib/hiring/http';
import { searchWorkspace } from '@/lib/hub/global-search';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const member=await requireHubMember(request);return jsonResponse({data:await searchWorkspace(await getHubStore(request),member,new URL(request.url).searchParams)});}catch(error){return errorResponse(error);}}
