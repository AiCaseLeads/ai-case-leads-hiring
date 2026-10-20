import {getHiringEnv} from '@/lib/hiring/runtime';
import {HubStore} from '@/lib/hub/store';
import {shareHeaders} from '@/lib/hub/applicant-share';
import {verifyShareEmail} from '@/lib/hub/share-verification';
import {errorResponse} from '@/lib/hiring/http';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
 try{const db=getHiringEnv().DB;if(!db)throw Error('storage_unavailable');return await verifyShareEmail(request,new HubStore(db),(await context.params).token);}catch(error){return shareHeaders(errorResponse(error));}
}
