import {requireHubMember} from '@/lib/hub/auth';
import {getHubStore} from '@/lib/hub/runtime';
import {errorResponse,jsonResponse} from '@/lib/hiring/http';
import {uploadInterviewRecording,listInterviewRecordings} from '@/lib/meetgeek/recordings';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const member=await requireHubMember(request);return jsonResponse({data:await uploadInterviewRecording(request,await getHubStore(request),member)});}catch(error){return errorResponse(error);}}

export async function GET(request:Request){try{await requireHubMember(request);const applicationId=new URL(request.url).searchParams.get("applicationId");if(!applicationId)return jsonResponse({data:[]});return jsonResponse({data:await listInterviewRecordings(await getHubStore(request),applicationId)});}catch(error){return errorResponse(error);}}
