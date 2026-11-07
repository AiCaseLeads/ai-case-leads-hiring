import {requireHubMember} from '@/lib/hub/auth';
import {getHubStore} from '@/lib/hub/runtime';
import {errorResponse} from '@/lib/hiring/http';
import {readInterviewRecording} from '@/lib/meetgeek/recordings';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{await requireHubMember(request);return readInterviewRecording(request,(await context.params).id,await getHubStore(request));}catch(error){return errorResponse(error);}}
