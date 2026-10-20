import { AUTOMATIC_REPLY_TO } from './email/contracts';
import { automaticMailTransport, reserveAutomaticMail, isAutomaticMailDeferred, type AutomaticMailResolver } from './email/service';
import { candidateTaskMailMode, isRejectionTask, isMailSetupError } from "./google/mail-setup";
import { processStaffInvites } from "./staff/service";
import { interviewCalendar } from "./personal-calendar/service";
import { personalCalendarEffect } from "./personal-calendar/client";
import { jobNotificationMail,candidateMail,CANDIDATE_SENDER } from "./job-team/service";
import { HubStore } from "./hub/store";
import type { Task } from "./hub/types";
import type { GoogleWorkspace, OriginalFileSource, InterviewInput, MailInput } from "./google/workspace";
import { sha256 } from "./hiring/crypto";
import { cleanupExpiredUploads } from "./hiring/upload-cleanup";
import { withinDeadline } from "./hiring/deadline";
import { syncHiringReplies } from "./mail-sync";
import { enqueueReviewReminders, reviewReminderMail } from "./review-reminders/service";
import { DriveArchiveContinuation, DriveArchiveFailure, type DriveArchiveProgress } from "./google/drive";

export type CandidateMailResolver=(account:string)=>Promise<GoogleWorkspace|null>;
async function candidateTransport(store:HubStore,account:string|undefined,resolver?:CandidateMailResolver){
 if(!account||account.toLowerCase()==="sales@aicaseleads.com")throw {code:"candidate_mail_account_not_configured"};
 const client=resolver?await resolver(account):await (async()=>{
  const {personalMailWorkspace}=await import("./personal-mail/service");
  const {resolvedWorkspaceEnv}=await import("./workspace-config");
  return personalMailWorkspace(store,account,await resolvedWorkspaceEnv());
 })();
 if(!client)throw {code:"candidate_mail_account_connection_required"};
 return client;
}
function safeCode(error:unknown):string{
  const code=error&&typeof error==="object"&&"code"in error?error.code:null;
  return typeof code==="string"&&/^[a-z0-9_]{1,100}$/.test(code)?code:"workspace_task_failed";
}
async function reconcileArchives(db:D1Database,store:HubStore){
  // Current local records are authoritative. A missed queue insertion is repaired
  // without replaying candidate decisions or sending another invitation.
  const result=await db.prepare("SELECT a.id,a.revision FROM hub_applications a WHERE NOT EXISTS (SELECT 1 FROM hub_tasks t WHERE t.application_id=a.id AND t.kind='drive' AND (t.status IN ('pending','running') OR (t.status='done' AND CAST(json_extract(t.result_json,'$.archivedRevision') AS INTEGER)>=a.revision))) AND NOT EXISTS (SELECT 1 FROM hub_tasks repaired WHERE repaired.id='drive:'||a.id||':reconcile:'||a.revision) ORDER BY a.updated_at LIMIT 100").all<{id:string;revision:number}>();
  const now=Date.now();
  if(result.results.length)await db.batch(result.results.map(app=>store.taskStatement(`drive:${app.id}:reconcile:${app.revision}`,app.id,"drive",{applicationId:app.id},now)));
}
export async function reconcileLegacyPdfArchives(db:D1Database,store:HubStore){
  const outstanding=await db.prepare("SELECT COUNT(*) AS count FROM hub_tasks WHERE kind='drive' AND (status IN ('pending','running') OR (status='failed' AND attempts<8)) AND id LIKE 'drive:%:pdf-current-v3:%'").first<{count:number}>();
  if(Number(outstanding?.count||0)>0)return 0;
  // Upgrade completed archives to one current PDF. Small batches protect new intake
  // and Drive quotas; candidate decisions and emails are never replayed.
  const result=await db.prepare("SELECT a.id,a.revision FROM hub_applications a WHERE EXISTS(SELECT 1 FROM hub_tasks old WHERE old.application_id=a.id AND old.kind='drive' AND old.status='done' AND CAST(json_extract(old.result_json,'$.archivedRevision') AS INTEGER)>=a.revision AND COALESCE(json_extract(old.result_json,'$.archiveFormat'),'')<>'pdf-current-v3') AND NOT EXISTS(SELECT 1 FROM hub_tasks t WHERE t.application_id=a.id AND t.kind='drive' AND (t.status IN ('pending','running') OR (t.status='done' AND json_extract(t.result_json,'$.archiveFormat')='pdf-current-v3' AND CAST(json_extract(t.result_json,'$.archivedRevision') AS INTEGER)>=a.revision))) AND NOT EXISTS(SELECT 1 FROM hub_tasks backfill WHERE backfill.id='drive:'||a.id||':pdf-current-v3:'||a.revision) ORDER BY a.updated_at DESC,a.id LIMIT 10").all<{id:string;revision:number}>();
  const now=Date.now();
  if(result.results.length)await db.batch(result.results.map(app=>store.taskStatement(`drive:${app.id}:pdf-current-v3:${app.revision}`,app.id,'drive',{applicationId:app.id,pdfBackfill:true},now)));
  return result.results.length;
}
async function reconcileUncertain(db:D1Database,store:HubStore,max:number,deadline:number,resolver?:CandidateMailResolver,automaticResolver:AutomaticMailResolver=automaticMailTransport){
  const now=Date.now();
  const result=await db.prepare("SELECT id,application_id,payload_json FROM hub_tasks WHERE kind='gmail' AND status='uncertain' AND run_after<=? ORDER BY updated_at LIMIT ?").bind(now,max).all<{id:string;application_id:string;payload_json:string}>();
  let reconciled=0;
  for(const item of result.results){
    if(Date.now()>=deadline-1000)break;
    const lease=crypto.randomUUID();
    const claimed=await db.prepare("UPDATE hub_tasks SET status='running',lease_token=?,lease_until=?,updated_at=? WHERE id=? AND status='uncertain' AND run_after<=? RETURNING id").bind(lease,Date.now()+5*60*1000,Date.now(),item.id,Date.now()).first();
    if(!claimed)continue;
    try{
      const payload=JSON.parse(item.payload_json) as MailInput & {jobNotification?:boolean;reviewReminder?:boolean;deliveryAccount?:string;deliveryProvider?:string;deliveryFingerprint?:string;deliveryTo?:string;deliveryStartedAt?:number};
      let found:Record<string,unknown>|null;
      if(payload.deliveryProvider==='sendgrid'){
        const transport=await automaticResolver();transport.setDeadline?.(deadline);
        if(!payload.deliveryFingerprint||payload.deliveryFingerprint!==transport.fingerprint||!payload.deliveryTo)throw {code:'transactional_mail_reconciliation_identity_changed'};
        found=await transport.reconcileMail(payload.messageId,payload.deliveryTo,payload.deliveryStartedAt);
      }else{
        // Missing provider is a legacy Gmail send, never a reason to migrate uncertainty.
        if(payload.deliveryProvider&&payload.deliveryProvider!=='gmail')throw {code:'mail_delivery_provider_unknown'};
        const internal=payload.jobNotification===true||payload.reviewReminder===true;
        const transport=await candidateTransport(store,payload.deliveryAccount || (internal?process.env.CANDIDATE_MAIL_ACCOUNT:undefined),resolver);
        transport.setDeadline?.(deadline);
        const gmailResult=await transport.reconcileMail(payload.messageId);found=gmailResult?{...gmailResult}:null;
      }
      await store.finishTask(item.id,lease,found?{status:"done",result:{...found}}:{status:"uncertain",error:"mail_delivery_not_yet_confirmed",runAfter:Date.now()+15*60*1000});
      if(found)reconciled++;
    }catch(error){await store.finishTask(item.id,lease,{status:"uncertain",error:safeCode(error),runAfter:Date.now()+15*60*1000});}
  }
  return reconciled;
}
async function sendAutomaticTask(task:Task,mail:MailInput,store:HubStore,db:D1Database,deadline:number,resolve:AutomaticMailResolver){
  const transport=await resolve();transport.setDeadline?.(deadline);
  await transport.verify();
  await reserveAutomaticMail(store);
  const {deliveryAccount:_oldAccount,...payload}=task.payload;void _oldAccount;
  const pinned=await db.prepare("UPDATE hub_tasks SET payload_json=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>? RETURNING id").bind(JSON.stringify({...payload,deliveryProvider:'sendgrid',deliveryFingerprint:transport.fingerprint,deliveryTo:mail.to,deliveryStartedAt:Date.now()}),task.id,task.leaseToken,Date.now()).first();
  if(!pinned)throw {code:'task_lease_expired'};
  return {...await transport.sendMail({...mail,sender:CANDIDATE_SENDER,replyTo:[AUTOMATIC_REPLY_TO],candidateAccount:undefined})};
}
async function taskEffect(task:Task,store:HubStore,db:D1Database,bucket:R2Bucket|undefined,google:GoogleWorkspace|undefined,deadline:number,owners:string[],resolver?:CandidateMailResolver,automaticResolver:AutomaticMailResolver=automaticMailTransport):Promise<Record<string,unknown>>{
  if(task.kind==='gmail'||task.kind==='calendar') {
    const {applicationTrash}=await import('./hub/application-lifecycle');
    if(await applicationTrash(store,task.applicationId)) return {stale:true,applicationTrashed:true};
  }
  if(task.kind==="gmail"){
    if(task.payload.jobNotification===true){
      const mail=await jobNotificationMail(task,store,owners);
      if(!mail||mail.to.trim().toLowerCase()==="sales@aicaseleads.com")return {stale:true};
      return sendAutomaticTask(task,mail,store,db,deadline,automaticResolver);
    }
    if(task.payload.reviewReminder===true){
      const mail=await reviewReminderMail(task,store,owners);
      if(!mail||mail.to.trim().toLowerCase()==="sales@aicaseleads.com")return {stale:true};
      return sendAutomaticTask(task,mail,store,db,deadline,automaticResolver);
    }
    if(task.payload.reminder===true){
      const current=await db.prepare("SELECT revision,status,start FROM hub_interviews WHERE id=? AND application_id=?").bind(String(task.payload.interviewId||""),task.applicationId).first<{revision:number;status:string;start:string|null}>();
      if(!await store.setting("interview_reminders_enabled",false)||!current||current.status!=="booked"||current.revision!==Number(task.payload.revision)||current.start!==task.payload.interviewStart||!current.start||!Number.isFinite(Date.parse(current.start))||Date.parse(current.start)<=Date.now()||["Rejected","Withdrawn","Hired"].includes((await store.applicationRow(task.applicationId)).stage))return {stale:true};
    }
    if(task.id===`gmail:${task.applicationId}:rejection`||task.id.startsWith(`gmail:${task.applicationId}:rejection:`)) {
      const decision=await store.applicationRow(task.applicationId);
      if(decision.stage!=="Rejected"||task.createdAt<decision.stage_entered_at)return {stale:true,supersededRejection:true};
    }
    if(/:(assessment|interview):/.test(task.id)&&["Rejected","Withdrawn","Hired"].includes((await store.applicationRow(task.applicationId)).stage))return {stale:true};
    if(/:(assessment|interview):.*:invitation:/.test(task.id)) {
      const linkKind=task.id.includes(":assessment:")?"assessment":"interview";
      const match=typeof task.payload.body==="string"?new RegExp(`https?:\\/\\/[^\\s]+\\/${linkKind}\\/([a-f0-9]{64})(?:\\s|$)`).exec(task.payload.body):null;
      const link=match?await db.prepare("SELECT expires_at,used_at FROM hub_links WHERE token_hash=? AND application_id=? AND kind=?").bind(await sha256(match[1]),task.applicationId,linkKind).first<{expires_at:number;used_at:number|null}>():null;
      if(!link||link.used_at!==null||link.expires_at<=Date.now())return {stale:true,expiredInvitation:true};
    }
    const mail=await candidateMail(store,task.payload as unknown as MailInput,owners,{mailMode:candidateTaskMailMode(task.id,task.applicationId,task.payload),actor:task.payload.actor,applicationId:task.applicationId,rejection:isRejectionTask(task.id,task.applicationId)});
    if(mail.sender===CANDIDATE_SENDER)return sendAutomaticTask(task,mail,store,db,deadline,automaticResolver);
    const transport=await candidateTransport(store,mail.candidateAccount,resolver);
    transport.setDeadline?.(deadline);
    // Pin transport before the irreversible send so an uncertain response is reconciled in the same mailbox.
    const pinned=await db.prepare("UPDATE hub_tasks SET payload_json=? WHERE id=? AND lease_token=? AND status='running' RETURNING id").bind(JSON.stringify({...task.payload,deliveryProvider:"gmail",deliveryAccount:mail.candidateAccount}),task.id,task.leaseToken).first();
    if(!pinned)throw {code:"task_lease_expired"};
    return {...await transport.sendMail(mail)};
  }
  if(task.kind==="calendar"){
    if(!google)throw {code:'google_not_connected'};
    const payload=task.payload as unknown as InterviewInput&{operation:string;interviewId:string};
    const current=await db.prepare("SELECT revision,status,calendar_id FROM hub_interviews WHERE id=?").bind(payload.interviewId).first<{revision:number;status:string;calendar_id:string|null}>();
    if(!current||current.revision!==Number(task.payload.revision)||!["pending","cancel_pending"].includes(current.status))return {stale:true};
    if(payload.operation!=="cancel"&&["Rejected","Withdrawn","Hired"].includes((await store.applicationRow(task.applicationId)).stage))return {stale:true};
    const calendarId=typeof task.payload.calendarId==="string"?task.payload.calendarId:current.calendar_id;
    if(!calendarId)throw {code:"interview_calendar_identity_missing"};
    if(current.calendar_id&&calendarId!==current.calendar_id)throw {code:"interview_calendar_identity_mismatch"};
    const personal=await interviewCalendar(store,payload.interviewId);
    if(personal){
      if(personal.calendarId!==calendarId)throw {code:"interview_calendar_identity_mismatch"};
      const {resolvedWorkspaceEnv}=await import("./workspace-config");
      return personalCalendarEffect(store,personal,{...payload,calendarId},await resolvedWorkspaceEnv(),fetch,deadline);
    }
    if(payload.operation==="cancel"){await google.cancelInterview(payload.id||payload.interviewId,calendarId);return {cancelled:true};}
    const pinned={...payload,calendarId};
    const result=payload.operation==="update"?await google.updateInterview(pinned):await google.createInterview(pinned);
    return {...result};
  }
  if(!google)throw {code:'google_not_connected'};
  if(!bucket)throw {code:"original_file_storage_unavailable"};
  const detail=await store.getApplication(task.applicationId),files:OriginalFileSource[]=[];
  for(const file of detail.files){
    files.push({id:file.id,name:file.filename,mimeType:file.contentType,size:file.size,load:async()=>{
      const row=await db.prepare("SELECT object_key FROM hub_files WHERE id=? AND application_id=? AND uploaded_at>0").bind(file.id,detail.id).first<{object_key:string}>();
      if(!row)throw {code:"original_file_identity_missing"};
      const object=await withinDeadline(()=>bucket.get(row.object_key),deadline,"storage_deadline_exceeded");
      if(!object||object.size!==file.size||object.customMetadata?.fileId!==file.id)throw {code:"original_file_identity_mismatch"};
      return new Uint8Array(await withinDeadline(()=>object.arrayBuffer(),deadline,"storage_deadline_exceeded"));
    }});
  }
  if((await store.applicationRow(detail.id)).revision!==detail.revision)throw {code:"archive_snapshot_changed"};
  const existing=await db.prepare("SELECT drive_folder_id FROM hub_applications WHERE id=?").bind(detail.id).first<{drive_folder_id:string|null}>();
  const key=`drive_original_checkpoint:${detail.id}:${detail.revision}`;
  const fingerprint=await sha256(JSON.stringify(detail.files.map(file=>[file.id,file.filename,file.contentType,file.size])));
  const continuation={
    read:async()=>{
      const saved=await store.setting<{fingerprint:string;nextIndex:number}|null>(key,null);
      if(saved&&saved.fingerprint!==fingerprint)throw {code:"drive_checkpoint_identity_mismatch"};
      return saved?.nextIndex??0;
    },
    write:async(nextIndex:number)=>{await store.setSetting(key,{fingerprint,nextIndex});},
    readProgress:async()=>await store.setting<DriveArchiveProgress|null>(`drive_pdf_checkpoint:${detail.id}:${detail.revision}`,null),
    writeProgress:async(progress:DriveArchiveProgress)=>{await store.setSetting(`drive_pdf_checkpoint:${detail.id}:${detail.revision}`,progress);},
  };
  return {...await google.archiveApplication(detail,files,existing?.drive_folder_id||undefined,continuation),archivedRevision:detail.revision};
}
export async function processHubTasks(store:HubStore,db:D1Database,bucket:R2Bucket|undefined,google:GoogleWorkspace|undefined,max=5,owners:string[]=(process.env.ADMIN_EMAILS||"").split(","),candidateResolver?:CandidateMailResolver,automaticResolver?:AutomaticMailResolver){
  const began=Date.now(),deadline=began+40_000;
  const resolveAutomatic=automaticResolver||(()=>automaticMailTransport(store));
  google?.setDeadline?.(deadline);
  const previous=await store.setting<Record<string,unknown>>("worker_health",{});
  await store.setSetting("worker_health",{...previous,lastStartedAt:began});
  let processed=0,failed=0,uncertain=0,reconciled=0,replies=0;
  try {
    // Mail authorization is independent of the company Drive/calendar connection.
    // A missing recruiter grant must not stop accepted applications being archived.
    let recruitingMail:GoogleWorkspace|null=null;
    try{recruitingMail=await candidateTransport(store,process.env.CANDIDATE_MAIL_ACCOUNT,candidateResolver);recruitingMail.setDeadline?.(deadline);}catch{/* Individual queued mail exposes setup errors below. */}
    await processStaffInvites(store,recruitingMail||undefined,owners,3,resolveAutomatic);
    await enqueueReviewReminders(store,owners);
    await reconcileArchives(db,store);
  await reconcileLegacyPdfArchives(db,store);
    reconciled=await reconcileUncertain(db,store,Math.min(max,5),deadline,candidateResolver,resolveAutomatic);
    for(let index=0;index<Math.max(1,Math.min(max,10));index++){
      if(Date.now()>=deadline-1000)break;
      const task=await store.claimTask(Date.now(),deadline-Date.now()<30_000);if(!task)break;
      if(!task.leaseToken)throw new Error("task_lease_missing");
      let providerCompleted=false;
      try{
        const result=await taskEffect(task,store,db,bucket,google,deadline,owners,candidateResolver,automaticResolver);
        providerCompleted=true;
        await store.finishTask(task.id,task.leaseToken,{status:"done",result});processed++;
      }catch(error){
        if(task.kind==="drive"&&error instanceof DriveArchiveContinuation){
          await store.finishTask(task.id,task.leaseToken,{status:"pending",error:error.code,runAfter:Date.now()+30_000,continuation:true,result:{continuation:true,phase:error.phase,...(error.diagnostics?{diagnostics:error.diagnostics}:{})}});
          continue;
        }
        const ambiguous=["gmail","calendar"].includes(task.kind)&&(providerCompleted||!!(error&&typeof error==="object"&&"uncertain"in error&&error.uncertain));
        const code=safeCode(error);
        if(task.kind==='gmail'&&!ambiguous&&isAutomaticMailDeferred(code)){
          const requested=error&&typeof error==='object'&&'retryAt'in error?Number(error.retryAt):0;
          const retryAt=Number.isFinite(requested)&&requested>Date.now()?Math.min(requested,Date.now()+25*3600_000):Date.now()+3600_000;
          await store.finishTask(task.id,task.leaseToken,{status:'pending',error:code,runAfter:retryAt,mailDeferred:true});
          continue;
        }
        const status=ambiguous?"uncertain":"failed";
        const setupHold=task.kind==="gmail"&&!ambiguous&&isMailSetupError(code);
        const delay=Math.min(6*60*60*1000,5000*2**Math.min(task.attempts,12));
        await store.finishTask(task.id,task.leaseToken,{status,error:code,runAfter:setupHold?Number.MAX_SAFE_INTEGER:Date.now()+delay,setupHold,...(error instanceof DriveArchiveFailure?{result:{phase:error.phase,diagnostics:error.diagnostics}}:{}),...(setupHold?{result:{setupRequired:true,retryRequiresReview:true,instructions:"Connect and verify the appropriate email service. Review this queued message before explicitly retrying; connecting an account alone will not send it."}}:{})});
        if(ambiguous)uncertain++;else failed++;
      }
    }
    if(recruitingMail&&Date.now()<deadline-1000)replies=await syncHiringReplies(store,db,recruitingMail,50,deadline,bucket);
    const cleanup=Date.now()<deadline-1000?await cleanupExpiredUploads(db,bucket,deadline,2):{deleted:0,failed:0};
    const count=await db.prepare("SELECT SUM(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,SUM(CASE WHEN status='uncertain' THEN 1 ELSE 0 END) AS uncertain FROM hub_tasks").first<{pending:number;failed:number;uncertain:number}>();
    const mailError=await store.setting("mail_sync_last_error","");
    const error=cleanup.failed?"Expired upload cleanup needs attention.":failed||uncertain||count?.failed||count?.uncertain?"Integration tasks need attention. Review failed or uncertain deliveries.":mailError;
    const result={processed,reconciled,failed,uncertain,replies,pending:count?.pending||0,cleanupDeleted:cleanup.deleted,cleanupFailed:cleanup.failed};
    await store.setSetting("worker_health",{lastStartedAt:began,lastCompletedAt:Date.now(),lastSuccessfulAt:error?previous.lastSuccessfulAt||null:Date.now(),...result,failed:count?.failed||failed,uncertain:count?.uncertain||uncertain,mailSyncAt:await store.setting("mail_sync_last_checked_at",null),error});
    return {...result,healthy:!error,error};
  }catch(error){
    await store.setSetting("worker_health",{...previous,lastStartedAt:began,lastCompletedAt:Date.now(),processed,failed,uncertain,error:safeCode(error)});
    throw error;
  }finally{google?.setDeadline?.(undefined);}
}
export async function schedulerAuthorized(request:Request,secret?:string):Promise<boolean>{
  const bearer=request.headers.get("authorization");
  if(!secret||!bearer?.startsWith("Bearer ")||bearer.length>256)return false;
  return await sha256(bearer.slice(7))===await sha256(secret);
}
