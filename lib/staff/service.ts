import { AUTOMATIC_SENDER } from '../email/contracts';
import { z } from "zod";
import type { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import type { GoogleWorkspace } from "../google/workspace";
import { HiringError } from "../hiring/errors";
import { isMailSetupError } from "../google/mail-setup";
import type { AutomaticMailResolver } from "../email/service";

export const staffInput = z.object({ email: z.string().trim().email().max(254).transform(s=>s.toLowerCase()), role:z.enum(["admin","recruiter"]), active:z.boolean().default(true), sendInvite:z.boolean().default(false), resendInvite:z.boolean().default(false), expectedUpdatedAt:z.number().int().nonnegative().optional() }).strict();
type Invite = { id:string; email:string; status:"pending"|"running"|"sent"|"failed"|"uncertain"|"cancelled"; createdAt:number; sentAt:number|null; lastError:string|null; attempts:number; runAfter:number; leaseUntil:number; messageId:string; origin:string; actor:string; deliveryProvider?:"gmail"|"sendgrid"; deliveryFingerprint?:string; deliveryStartedAt?:number; providerId?:string };
type Row = {id:string;email:string;role:"admin"|"recruiter";active:number;updated_at:number};
const ownerList=(owners:string[])=>owners.map(s=>s.trim().toLowerCase()).filter(Boolean);
const inviteKey=(email:string)=>`staff_invite:${email}`;
export async function staffTeam(store:HubStore,actor:HubMember,owners:string[]){
 const rows=(await store.stmt("SELECT id,email,role,active,updated_at FROM hub_members ORDER BY email").all<Row>()).results;
 const actualOwners=ownerList(owners);
 for(const email of actualOwners)if(!rows.some(r=>r.email===email))rows.push({id:email,email,role:"admin",active:1,updated_at:0});
 return {canManageTeam:actor.role==="admin",members:await Promise.all(rows.map(async row=>{const invite=await store.setting<Invite|null>(inviteKey(row.email),null);return {email:row.email,role:actualOwners.includes(row.email)?"admin":row.role,active:!!row.active,isOwner:actualOwners.includes(row.email),updatedAt:row.updated_at,invite:invite?{status:invite.status,lastError:invite.lastError,createdAt:invite.createdAt,sentAt:invite.sentAt}:null};}))};
}
export async function updateStaff(store:HubStore,actor:HubMember,owners:string[],input:z.infer<typeof staffInput>,origin:string){
 if(actor.role!=="admin")throw new HiringError("admin_access_required",403,"Only the head recruiter or owner can manage recruiting staff.");
 const actualOwners=ownerList(owners);
 const previous=await store.stmt("SELECT id,email,role,active,updated_at FROM hub_members WHERE email=?",input.email).first<Row>();
 if(actualOwners.includes(input.email)||input.email===actor.email)throw new HiringError("protected_member",403,"Your own access and owner accounts cannot be changed here.");
 if(!actor.isOwner&&(input.role==="admin"||previous?.role==="admin"))throw new HiringError("owner_access_required",403,"Only the owner can appoint or change a head recruiter.");
 if(input.expectedUpdatedAt!==undefined&&input.expectedUpdatedAt!==(previous?.updated_at||0))throw new HiringError("team_changed",409,"This person's access changed. Refresh before saving.");
 const priorInvite=await store.setting<Invite|null>(inviteKey(input.email),null),now=Date.now();
 let invite=priorInvite;
 if(!input.active&&invite&&invite.status!=="sent")invite={...invite,status:"cancelled",lastError:null};
 if(input.sendInvite&&input.active){
  if(input.resendInvite&&priorInvite&&["pending","running","uncertain"].includes(priorInvite.status))throw new HiringError("invite_pending",409,"The existing invitation is still pending or awaiting delivery confirmation.");
  if(input.resendInvite&&priorInvite&&now-priorInvite.createdAt<5*60_000)throw new HiringError("invite_cooldown",429,"Wait five minutes before sending another invitation.");
  if(!priorInvite||priorInvite.status==="cancelled"||input.resendInvite){const id=crypto.randomUUID();invite={id,email:input.email,status:"pending",createdAt:now,sentAt:null,lastError:null,attempts:0,runAfter:now,leaseUntil:0,messageId:`<staff-invite-${id}@${new URL(origin).hostname}>`,origin,actor:actor.email};}
 }
 // Guard membership and invitation snapshots together. NULL intentionally aborts
 // the transaction if another manager/worker changed either after this read.
 const guardKey=`staff_write:${crypto.randomUUID()}`;
 const writes=[store.stmt("INSERT INTO hub_settings(key,value,updated_at) SELECT ?,CASE WHEN COALESCE((SELECT updated_at FROM hub_members WHERE email=?),0)=? AND COALESCE((SELECT value FROM hub_settings WHERE key=?),'null')=? THEN 'true' ELSE NULL END,?",guardKey,input.email,previous?.updated_at||0,inviteKey(input.email),JSON.stringify(priorInvite),now),store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role,active=excluded.active,updated_at=excluded.updated_at",previous?.id||crypto.randomUUID(),input.email,input.role,input.active?1:0,now,Math.max(now,(previous?.updated_at||0)+1))];
 if(invite)writes.push(store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",inviteKey(input.email),JSON.stringify(invite),now));
 writes.push(store.stmt("INSERT INTO hub_audit(id,type,actor,before_json,after_json,created_at) VALUES(?,'staff_access',?,?,?,?)",crypto.randomUUID(),actor.email,JSON.stringify(previous),JSON.stringify({email:input.email,role:input.role,active:input.active,inviteId:invite?.id}),now),store.stmt("DELETE FROM hub_settings WHERE key=?",guardKey));
 try{await store.db.batch(writes);}catch(error){if(/NOT NULL|constraint/i.test(String(error)))throw new HiringError("team_changed",409,"Team access or invitation status changed. Refresh before saving.");throw error;}
 return staffTeam(store,actor,owners);
}
function safeError(error:unknown){const code=error&&typeof error==="object"&&"code" in error?String(error.code):"invite_delivery_failed";return /^[a-z0-9_]{1,80}$/.test(code)?code:"invite_delivery_failed";}
export async function processStaffInvites(store:HubStore,google:Pick<GoogleWorkspace,"sendMail"|"reconcileMail">|null|undefined,owners:string[],max=3,automaticResolver?:AutomaticMailResolver){
 const now=Date.now();
 const rows=(await store.stmt("SELECT key,value FROM hub_settings WHERE key LIKE 'staff_invite:%' AND json_extract(value,'$.status') IN ('pending','failed','running','uncertain') AND json_extract(value,'$.runAfter')<=? AND json_extract(value,'$.leaseUntil')<=? ORDER BY updated_at LIMIT ?",now,now,max).all<{key:string;value:string}>()).results;
 let sent=0;
 for(const row of rows){
  const old=JSON.parse(row.value) as Invite;
  let claim:Invite={...old,status:"running" as const,leaseUntil:Date.now()+90_000,attempts:old.attempts+1};
  const claimed=await store.stmt("UPDATE hub_settings SET value=?,updated_at=? WHERE key=? AND value=? RETURNING key",JSON.stringify(claim),Date.now(),row.key,row.value).first();if(!claimed)continue;
  let next:Invite=claim,providerStarted=false,deliveredNow=false;
  let automaticHelpers:typeof import("../email/service")|undefined;
  try{
   const active=await store.stmt("SELECT role FROM hub_members WHERE email=? AND active=1",old.email).first<{role:string}>();
   if(!active||ownerList(owners).includes(old.email)){next={...claim,status:"cancelled",lastError:null};}
   else{
    // A crashed/ambiguous send stays with its original provider. Missing provider
    // metadata identifies legacy Gmail; a negative search never permits a resend.
    const uncertain=["running","uncertain"].includes(old.status);
    const useAutomatic=old.deliveryProvider==="sendgrid"||(!uncertain&&!!automaticResolver);
    const mail={to:old.email,messageId:old.messageId,subject:"You're invited to AI Case Leads Hiring",body:`You have been invited to AI Case Leads Hiring as ${active.role==="admin"?"Head recruiter":"Recruiter"}.\n\nSign in with ${old.email}:\n${old.origin}/team?view=settings\n\nConnect your own recruiting Gmail and Google Calendar under Settings → My connections, then save your interview hours. Your password is never shared with your manager. Open Jobs to create or manage a posting.\n\nRecruiter guide:\n${old.origin}/recruiter-guide.pdf\n\nAutomatic application emails are sent by the hiring system from ${AUTOMATIC_SENDER}. Recruiter conversations use your connected recruiting mailbox. Company Drive storage remains separate; your email and calendar connections are personal. Contact your hiring manager if you need help.`};
    let delivered:Record<string,unknown>|null;
    if(useAutomatic){
     automaticHelpers=await import("../email/service");
     const transport=await (automaticResolver||automaticHelpers.automaticMailTransport)();
     transport.setDeadline?.(Date.now()+20_000);
     if(uncertain){
      if(old.deliveryFingerprint!==transport.fingerprint)throw {code:"transactional_mail_configuration_changed",uncertain:false};
      delivered=await transport.reconcileMail(old.messageId,old.email,old.deliveryStartedAt);
     }else{
      await transport.verify();
      await automaticHelpers.reserveAutomaticMail(store);
      const pinned:Invite={...claim,deliveryProvider:"sendgrid",deliveryFingerprint:transport.fingerprint,deliveryStartedAt:Date.now()};
      const pin=await store.stmt("UPDATE hub_settings SET value=?,updated_at=? WHERE key=? AND value=? RETURNING key",JSON.stringify(pinned),Date.now(),row.key,JSON.stringify(claim)).first();
      if(!pin)throw {code:"invite_lease_lost",uncertain:false};
      claim=pinned;
      providerStarted=true;
      delivered=await transport.sendMail({...mail,sender:AUTOMATIC_SENDER,replyTo:[AUTOMATIC_SENDER]});
     }
    }else{
     if(!google)throw {code:"candidate_mail_account_connection_required",uncertain:false};
     const found=uncertain?await google.reconcileMail(old.messageId):null;
     delivered=found?{...found}:null;
     if(!uncertain){providerStarted=true;delivered={...await google.sendMail(mail)};}
    }
    if(delivered&&(typeof delivered.id!=="string"||!delivered.id))throw {code:"invite_delivery_response_invalid",uncertain:true};
    if(delivered){deliveredNow=true;next={...claim,status:"sent",sentAt:Date.now(),lastError:null,providerId:delivered.id as string};}else next={...claim,status:"uncertain",lastError:useAutomatic?"transactional_mail_delivery_not_yet_confirmed":"gmail_delivery_not_yet_confirmed",runAfter:Date.now()+15*60_000};
   }
  }catch(error){
   const code=safeError(error),ambiguous=["running","uncertain"].includes(old.status)||(providerStarted&&!(error&&typeof error==="object"&&"uncertain"in error&&error.uncertain===false));
   const deferred=!ambiguous&&!!automaticHelpers?.isAutomaticMailDeferred(code),setupHold=!ambiguous&&!!automaticHelpers&&isMailSetupError(code);
   const retryAt=error&&typeof error==="object"&&"retryAt"in error?Number(error.retryAt):0;
   next={...claim,status:ambiguous?"uncertain":deferred?"pending":"failed",lastError:code,attempts:deferred||setupHold?old.attempts:claim.attempts,runAfter:setupHold?Number.MAX_SAFE_INTEGER:deferred&&Number.isFinite(retryAt)&&retryAt>Date.now()?retryAt:Date.now()+(ambiguous?15*60_000:Math.min(6*60*60_000,30_000*2**Math.min(claim.attempts,10)))};
  }
  next.leaseUntil=0;
  const finished=await store.stmt("UPDATE hub_settings SET value=?,updated_at=? WHERE key=? AND value=?",JSON.stringify(next),Date.now(),row.key,JSON.stringify(claim)).run();
  if(finished.meta.changes===1&&deliveredNow)sent++;
 }
 return {sent};
}
