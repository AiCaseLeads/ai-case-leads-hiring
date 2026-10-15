import { jsonResponse,errorResponse,assertSameOrigin,readSession } from '@/lib/hiring/http';
import { verifyChallenge } from '@/lib/hiring/antispam';
import { privateToken } from '@/lib/hiring/crypto';
import { HiringError } from '@/lib/hiring/errors';
import { getHubStore } from '@/lib/hub/runtime';
import { helpInput,saveHelp,existingHelp,limitHelpVerification } from '@/lib/recruiting-help/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const response=jsonResponse({ready:true});
 if(!readSession(request))response.headers.set('Set-Cookie',`hiring_session=${privateToken()}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${new URL(request.url).protocol==='https:'?'; Secure':''}`);
 return response;
}
export async function POST(request:Request){try{
 assertSameOrigin(request);const session=readSession(request);
 if(!session)throw new HiringError('session_required',409,'Reload the help form before submitting.');
 if(!request.body)throw new HiringError('invalid_request',400,'Enter your request.');
 const reader=request.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>20000){await reader.cancel();throw new HiringError('request_too_large',413,'Please shorten your message.');}chunks.push(part.value);}
 const parsed=helpInput.safeParse(JSON.parse(await new Blob(chunks as BlobPart[]).text()));
 if(!parsed.success)throw new HiringError('invalid_request',422,'Enter a valid email and a message between 10 and 4,000 characters.');
 const store=await getHubStore(request),ip=request.headers.get('cf-connecting-ip');
 if(await existingHelp(store,parsed.data,session))return jsonResponse({data:{id:parsed.data.id}},201);
 await limitHelpVerification(store,session,ip);
 await verifyChallenge(parsed.data.token,session,parsed.data.id,'recruiting-help',new URL(request.url).hostname);
 return jsonResponse({data:await saveHelp(store,parsed.data,session,ip)},201);
}catch(error){return errorResponse(error);}}
