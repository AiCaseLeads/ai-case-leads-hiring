import {HubStore} from './store';
import {readCurrentShare,shareAllowsEmail,shareHeaders} from './applicant-share';
import {assertSameOrigin} from '../hiring/http';
import {HiringError} from '../hiring/errors';
import {privateToken,sha256} from '../hiring/crypto';
import {shareViewerCookie} from '../railway/share-viewer';
import {automaticMailTransport,reserveAutomaticMail,type AutomaticMailResolver} from '../email/service';
import {AUTOMATIC_SENDER,AUTOMATIC_REPLY_TO} from '../email/contracts';
const browserName=(secure:boolean)=>secure?'__Host-aicl_share_code':'aicl_share_code';
const cookie=(name:string,value:string,secure:boolean,age:number)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
export async function verifyShareEmail(request:Request,store:HubStore,token:string,resolve:AutomaticMailResolver=()=>automaticMailTransport(store),now=Date.now()){
 assertSameOrigin(request);
 const reader=request.body?.getReader();if(!reader)throw new HiringError('invalid_request',400,'Enter your email and verification code.');
 const chunks:Uint8Array[]=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){await reader.cancel();throw new HiringError('invalid_request',400,'Enter your email and verification code.');}chunks.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const raw=new TextDecoder().decode(bytes);
 let body:{email?:unknown;code?:unknown};try{body=JSON.parse(raw);}catch{throw new HiringError('invalid_request',400,'Enter your email and verification code.');}
 if(!body||typeof body.email!=='string'||body.email.length>254)throw new HiringError('invalid_request',400,'Enter a valid email.');
 const email=body.email.trim().toLowerCase(),share=await readCurrentShare(store,token);
 if(share.access==='public')throw new HiringError('verification_not_required',400,'This link does not require email verification.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!shareAllowsEmail(share,email))throw new HiringError('share_access_denied',403,'This email address does not have access to this shared application.');
 const secure=new URL(request.url).protocol==='https:',name=browserName(secure);
 const matches=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
 const existing=matches.length===1?matches[0].slice(name.length+1):'';
 const browser=/^[a-f0-9]{64}$/.test(existing)?existing:privateToken();
 const key='share_code:'+await sha256(share.hash+':'+email+':'+browser);
 if(body.code===undefined){
  // These independent server counters limit resend abuse even with new cookies.
  for(const [scope,limit] of [[`email:${email}`,5],[`share:${share.hash}`,30],[`ip:${request.headers.get('cf-connecting-ip')||request.headers.get('x-real-ip')||'unknown'}`,30]] as const){
   const row=await store.stmt('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES(?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 RETURNING attempts',await sha256('share-verify:'+scope),Math.floor(now/600000)).first<{attempts:number}>();
   if(!row||row.attempts>limit)throw new HiringError('rate_limited',429,'Too many verification requests. Try again in ten minutes.');
  }
  const random=new Uint32Array(1);do{crypto.getRandomValues(random);}while(random[0]>=4294000000);
  const code=String(random[0]%1000000).padStart(6,'0'),nonce=privateToken();
  const value={email,shareHash:share.hash,nonce,codeHash:await sha256(nonce+':'+code),expiresAt:now+600000,attempts:0};
  await store.setSetting(key,value);
  const mail=await resolve();mail.setDeadline?.(Date.now()+20000);await mail.verify();await reserveAutomaticMail(store,now);
  await mail.sendMail({to:email,subject:'Your application viewing code',body:`Your verification code is ${code}. It expires in ten minutes.\n\nIf you did not request this code, ignore this email. Please do not reply.`,messageId:`share-code-${nonce}@notify.aicaseleads.com`,sender:AUTOMATIC_SENDER,replyTo:[AUTOMATIC_REPLY_TO]});
  const response=shareHeaders(Response.json({sent:true}));response.headers.append('Set-Cookie',cookie(name,browser,secure,600));return response;
 }
 if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code)||!existing)throw new HiringError('invalid_code',400,'The code is invalid or expired. Request a new code.');
 const row=await store.stmt("UPDATE hub_settings SET value=json_set(value,'$.attempts',json_extract(value,'$.attempts')+1) WHERE key=? AND json_extract(value,'$.expiresAt')>? AND json_extract(value,'$.attempts')<5 RETURNING value",key,now).first<{value:string}>();
 if(!row)throw new HiringError('invalid_code',400,'The code is invalid or expired. Request a new code.');
 const challenge=JSON.parse(row.value);
 if(await sha256(challenge.nonce+':'+body.code)!==challenge.codeHash)throw new HiringError('invalid_code',400,'The code is invalid or expired. Request a new code.');
 const current=await readCurrentShare(store,token);if(!shareAllowsEmail(current,email))throw new HiringError('share_access_denied',403,'This email address does not have access.');
 const session=privateToken();
 // A compare-and-consume guard and session insertion share one SQLite transaction.
 try{await store.db.batch([
  store.stmt('UPDATE hub_settings SET value=CASE WHEN value=? THEN ? ELSE NULL END WHERE key=?',row.value,'{}',key),
  store.stmt("INSERT INTO hub_settings(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM hub_settings WHERE key=? AND value='{}')",'share_viewer:'+await sha256(session),JSON.stringify({email,expiresAt:now+12*3600000}),now,key),
  store.stmt('DELETE FROM hub_settings WHERE key=?',key),
 ]);}catch(error){if(/NOT NULL|constraint/i.test(String(error)))throw new HiringError('invalid_code',400,'The code has already been used or changed.');throw error;}
 const sessionExists=await store.setting<unknown>('share_viewer:'+await sha256(session),null);if(!sessionExists)throw new HiringError('invalid_code',400,'The code has already been used.');
 const response=shareHeaders(Response.json({verified:true}));response.headers.append('Set-Cookie',cookie(shareViewerCookie(secure),session,secure,43200));return response;
}
