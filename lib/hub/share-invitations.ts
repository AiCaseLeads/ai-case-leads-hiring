import {automaticMailTransport, reserveAutomaticMail, type AutomaticMailResolver} from '../email/service';
import {sha256} from '../hiring/crypto';
import {HiringError} from '../hiring/errors';
import {applicationTrash} from './application-lifecycle';
import type {HubStore} from './store';

type InvitationShare = {applicationId:string;hash:string;expiresAt:number;access?:string;emails?:string[]};
/** Explicit staff action. Recipient addresses come from the saved access policy, never this request. */
export async function sendShareInvitations(store:HubStore,id:string,token:string,origin:string,resolve:AutomaticMailResolver=()=>automaticMailTransport(store)) {
  if(!/^[a-f0-9]{64}$/.test(token)) throw new HiringError('invalid_share',422,'Create a sharing link first.');
  const hash=await sha256(token);
  const policy=await store.setting<InvitationShare|null>('applicant_share:'+id,null);
  if(!policy||policy.hash!==hash||policy.applicationId!==id||policy.expiresAt<=Date.now()||policy.access!=='people'||!policy.emails?.length||await applicationTrash(store,id)) throw new HiringError('share_unavailable',409,'Create a current link for specific people before sending invitations.');
  const transport=await resolve();
  transport.setDeadline?.(Date.now()+20_000);
  await transport.verify();
  const result={sent:0,alreadySent:0,failed:0,uncertain:0};
  for(const email of policy.emails){
    const key='share_invitation:'+hash+':'+await sha256(email);
    const previous=await store.setting<{status:string}|null>(key,null);
    if(previous){if(previous.status==='sent')result.alreadySent++;else result.uncertain++;continue;}
    const current=await store.setting<InvitationShare|null>('applicant_share:'+id,null);
    if(!current||current.hash!==hash||current.expiresAt<=Date.now()||await applicationTrash(store,id)) break;
    try{await reserveAutomaticMail(store);}catch{result.failed++;continue;}
    // Claim before provider POST: a lost/ambiguous response must never trigger an automatic resend.
    const claimed=await store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING RETURNING key",key,JSON.stringify({status:'sending'}),Date.now()).first();
    if(!claimed){result.uncertain++;continue;}
    try{
      await transport.sendMail({to:email,subject:'An applicant was shared with you',body:`AI Case Leads shared an applicant with you.\n\nView their résumé, application answers, and AI review:\n${origin}/shared-applicants/${token}\n\nVerify this email address with a code to open the application. This link expires on ${new Date(policy.expiresAt).toISOString().slice(0,10)}.\n\nThis is an automated email. Please do not reply.`,messageId:`share-${hash}-${(await sha256(email)).slice(0,16)}@aicaseleads.com`});
      await store.setSetting(key,{status:'sent'});result.sent++;
    }catch{
      await store.setSetting(key,{status:'uncertain'});result.uncertain++;
    }
  }
  return result;
}
