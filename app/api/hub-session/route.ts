import {requireHubMember} from '@/lib/hub/auth';
import {jsonResponse,errorResponse} from '@/lib/hiring/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const member=await requireHubMember(request);return jsonResponse({data:{email:member.email}})}catch(error){return errorResponse(error)}}
