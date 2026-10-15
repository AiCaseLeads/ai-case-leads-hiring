import {z} from 'zod';
import {requireHubMember} from '@/lib/hub/auth';
import {getHubStore} from '@/lib/hub/runtime';
import {assertSameOrigin,jsonResponse,errorResponse} from '@/lib/hiring/http';
import {HiringError} from '@/lib/hiring/errors';
import {listHelp,resolveHelp} from '@/lib/recruiting-help/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{await requireHubMember(request);const page=Number(new URL(request.url).searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>10000)throw new HiringError('invalid_request',400,'Invalid page.');return jsonResponse({data:await listHelp(await getHubStore(request),page)});}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request){try{const member=await requireHubMember(request);assertSameOrigin(request);const parsed=z.object({key:z.string().max(100),status:z.enum(['open','resolved'])}).strict().safeParse(await request.json());if(!parsed.success)throw new HiringError('invalid_request',400,'Invalid request.');const body=parsed.data;await resolveHelp(await getHubStore(request),body.key,body.status,member.email);return jsonResponse({data:{saved:true}});}catch(error){return errorResponse(error);}}
