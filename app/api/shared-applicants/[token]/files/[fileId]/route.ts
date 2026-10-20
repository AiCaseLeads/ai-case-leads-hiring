import {getHiringEnv} from '@/lib/hiring/runtime';
import {HubStore} from '@/lib/hub/store';
import {sharedApplicantFile,shareHeaders} from '@/lib/hub/applicant-share';
import {errorResponse} from '@/lib/hiring/http';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{token:string;fileId:string}>}){
 try{const env=getHiringEnv();if(!env.DB)throw Error('storage_unavailable');const {token,fileId}=await context.params;return await sharedApplicantFile(request,new HubStore(env.DB),token,fileId,env.BUCKET);}catch(error){return shareHeaders(errorResponse(error));}
}
export async function HEAD(request:Request,context:{params:Promise<{token:string;fileId:string}>}){const response=await GET(request,context);await response.body?.cancel();return new Response(null,{status:response.status,headers:response.headers});}
