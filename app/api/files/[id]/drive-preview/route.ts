import {requireHubMember} from '@/lib/hub/auth';
import {getHiringEnv} from '@/lib/hiring/runtime';
import {errorResponse} from '@/lib/hiring/http';
import {privateDrivePreview} from '@/lib/hub/drive-preview';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{const member=await requireHubMember(request);return await privateDrivePreview((await context.params).id,member,getHiringEnv().DB);}catch(error){return errorResponse(error);}
}
