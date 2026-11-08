import { z } from 'zod';
import type { HubStore } from './store';
import type { HubMember } from './auth-core';
import type { Task } from './types';
import type { MailInput } from '../google/gmail';
import { HiringError } from '../hiring/errors';
import { interviewSlotPredicate, interviewStageWithoutRecordSql, isInterviewFilter, sessionFilterPredicate, sessionProgressSql, type InterviewProgress } from './interview-progress';
import { activeApplicationsSql } from './application-lifecycle';
import { sha256 } from '../hiring/crypto';
import { notesReviews } from './note-review';

const CONFIG_KEY = 'recruiting_workflow_v1';
const email = z.string().trim().email().transform(value => value.toLowerCase());
export const workflowSettingsInput = z.object({approvers: z.array(email).min(1).max(25)}).strict();
export type WorkflowSettings = z.infer<typeof workflowSettingsInput>;
const defaultSettings: WorkflowSettings = {approvers: ['mariam@aicaseleads.com']};
const text = z.string().trim().max(20000);
const recording = z.string().trim().max(2000).refine(value => {
 if (!value) return true;
 if (/^\/api\/hub\/interview-recordings\/[a-f0-9-]{36}$/.test(value)) return true;
 if (/^\/api\/hub\/meetgeek\/meetings\/[A-Za-z0-9_-]+\/recording$/.test(value)) return true;
 try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use a secure recording URL.');
export const recruiterReviewInput = z.object({expectedVersion: z.number().int().min(0), recommendation: z.enum(['', 'advance', 'hold', 'reject']), notes: text, summary: text, recordingUrl: recording, salaryExpectation: z.string().trim().max(1000), availability: z.string().trim().max(2000), concerns: text}).strict();
export type RecruiterReviewInput = z.infer<typeof recruiterReviewInput>;
type ReviewRow = {application_id:string;version:number;recommendation:RecruiterReviewInput['recommendation'];notes:string;summary:string;recording_url:string;salary_expectation:string;availability:string;concerns:string;updated_by:string;updated_at:number};
export const HANDOFF_REQUIRED = ['Recommendation','Interview notes','Interview summary','Call recording','Salary expectation','Availability','Outstanding concerns (or None)'];
export async function workflowSettings(store:HubStore):Promise<WorkflowSettings>{
 const parsed=workflowSettingsInput.safeParse(await store.setting(CONFIG_KEY,defaultSettings));
 return parsed.success?parsed.data:defaultSettings;
}
export async function workflowApprovers(store:HubStore,owners:string[]=(process.env.ADMIN_EMAILS||'').split(',')){
 const config=await workflowSettings(store),staff=await store.members(),active=new Set(staff.filter(person=>person.active).map(person=>person.email.toLowerCase()));
 return [...new Set([...owners.map(value=>value.trim().toLowerCase()).filter(value=>email.safeParse(value).success),...config.approvers.filter(value=>active.has(value))])];
}
export async function canApproveHiring(store:HubStore,member:HubMember){
 if(member.isOwner===true)return true;
 const config=await workflowSettings(store);
 if(!config.approvers.includes(member.email.toLowerCase()))return false;
 return !!await store.stmt("SELECT id FROM hub_members WHERE lower(email)=? AND active=1 AND role IN ('admin','recruiter')",member.email.toLowerCase()).first();
}
export async function saveWorkflowSettings(store:HubStore,input:unknown,member:HubMember){
 if(!member.isOwner)throw new HiringError('owner_access_required',403,'Only the account owner can change hiring approvers.');
 const parsed=workflowSettingsInput.safeParse(input);if(!parsed.success)throw new HiringError('invalid_workflow_settings',422,'Choose valid hiring approver email addresses.');
 const staff=await store.members(),active=new Set(staff.filter(person=>person.active).map(person=>person.email.toLowerCase()));
 if(parsed.data.approvers.some(value=>!active.has(value)&&value!==member.email.toLowerCase()))throw new HiringError('invalid_approver',422,'Approvers must be active hiring staff.');
 const value={approvers:[...new Set(parsed.data.approvers)]},before=await workflowSettings(store),now=Date.now();
 await store.db.batch([store.settingStatement(CONFIG_KEY,value),store.stmt('INSERT INTO hub_audit(id,type,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),'hiring_approvers',member.email,JSON.stringify(before),JSON.stringify(value),now)]);
 return value;
}
interface HandoffQuestion {
 question: string;
 requestedBy: string;
 reviewVersion: number;
}

export async function prepareHandoffReturn(store: HubStore, id: string, assignee: string | null, reason: string | undefined, member: HubMember) {
 if (!await canApproveHiring(store,member))
   throw new HiringError('hiring_approval_required',403,'Only a hiring approver can return a handoff.');
 const question = reason?.trim();
 if (!question) throw new HiringError('question_required',422,'Enter the question the recruiter should answer.');
 const review = await getRecruiterReview(store,id);
 const submitter = await store.stmt("SELECT actor FROM hub_history WHERE application_id=? AND type='stage' AND to_stage='Awaiting Founder Review' ORDER BY created_at DESC,rowid DESC LIMIT 1",id).first<{actor:string}>();
 const owner = assignee || submitter?.actor || review.updatedBy;
 const active = owner && (await store.members()).some(person => person.active && person.email.toLowerCase() === owner.toLowerCase());
 return {assignee: active ? owner : null, request: {question, requestedBy:member.email, reviewVersion:review.version}};
}

export async function getRecruiterReview(store:HubStore,id:string,member?:HubMember){
 await store.applicationRow(id);
 const row=await store.stmt('SELECT * FROM hub_recruiter_reviews WHERE application_id=?',id).first<ReviewRow>();
 const review={version:row?.version||0,recommendation:row?.recommendation||'' as RecruiterReviewInput['recommendation'],notes:row?.notes||'',summary:row?.summary||'',recordingUrl:row?.recording_url||'',salaryExpectation:row?.salary_expectation||'',availability:row?.availability||'',concerns:row?.concerns||'',updatedBy:row?.updated_by||null,updatedAt:row?.updated_at||null};
 const fields=[review.recommendation,review.notes,review.summary,review.recordingUrl,review.salaryExpectation,review.availability,review.concerns];
 const missing: string[]=HANDOFF_REQUIRED.filter((_,index)=>!fields[index].trim());
 const evidenceRows=await store.rows<{value:string}>('SELECT value FROM hub_settings WHERE key LIKE ?',`interview_evidence:${id}:%`);
 const evidence=evidenceRows.flatMap(item=>{try{const value=JSON.parse(item.value) as Record<string,unknown>;return [{providerMeetingId:value.providerMeetingId,interviewId:value.interviewId,recordingUrl:value.recordingUrl,summary:value.summary,hasTranscript:!!value.transcript,attachedAt:value.attachedAt}];}catch{return [];}});
 const returned = await store.setting<HandoffQuestion|null>('handoff_return:'+id,null);
 if (returned && returned.reviewVersion >= review.version) missing.push('Updated handoff answering the reviewer’s question');
 return {...review,evidence,returned,readiness:{ready:missing.length===0,missing},canApprove:member?await canApproveHiring(store,member):false};
}
export async function saveRecruiterReview(store:HubStore,id:string,input:unknown,member:HubMember){
 const parsed=recruiterReviewInput.safeParse(input);if(!parsed.success)throw new HiringError('invalid_recruiter_review',422,'Check the review fields and recording link.');
 const next=parsed.data,app=await store.applicationRow(id),current=await getRecruiterReview(store,id);
 if(current.version!==next.expectedVersion)throw new HiringError('review_changed',409,'This review changed. Refresh before saving your notes.');
 const now=Date.now(),version=current.version+1;
 const summary=`Recruiter interview review\nRecommendation: ${next.recommendation||'Not selected'}\nNotes: ${next.notes||'Not entered'}\nSummary: ${next.summary||'Not entered'}\nRecording: ${next.recordingUrl?'Attached':'Missing'}\nSalary: ${next.salaryExpectation||'Not entered'}\nAvailability: ${next.availability||'Not entered'}\nConcerns: ${next.concerns||'Not entered'}`;
 const statements=[store.stmt("UPDATE hub_applications SET id=CASE WHEN revision=? AND NOT EXISTS(SELECT 1 FROM hub_settings WHERE key='application_trash:'||hub_applications.id) THEN id ELSE NULL END,revision=revision+1,updated_at=? WHERE id=?",app.revision,now,id),
 store.stmt('INSERT INTO hub_recruiter_reviews(application_id,version,recommendation,notes,summary,recording_url,salary_expectation,availability,concerns,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(application_id) DO UPDATE SET version=excluded.version,recommendation=excluded.recommendation,notes=excluded.notes,summary=excluded.summary,recording_url=excluded.recording_url,salary_expectation=excluded.salary_expectation,availability=excluded.availability,concerns=excluded.concerns,updated_by=excluded.updated_by,updated_at=excluded.updated_at',id,version,next.recommendation,next.notes,next.summary,next.recordingUrl,next.salaryExpectation,next.availability,next.concerns,member.email,now),
 store.stmt('INSERT INTO hub_history(id,application_id,type,text,actor,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'note',summary,member.email,now)];
 try{await store.db.batch(statements);}catch{throw new HiringError('review_changed',409,'The application changed. Refresh before saving your review.');}
 return getRecruiterReview(store,id,member);
}
export async function attachInterviewEvidence(store:HubStore,id:string,evidence:{summary?:string;recordingUrl?:string;transcript?:string;providerMeetingId?:string;interviewId?:string},actorEmail:string){
 const current=await getRecruiterReview(store,id);
 const existingEvidence=evidence.providerMeetingId?await store.setting<Record<string,unknown>|null>(`interview_evidence:${id}:${evidence.providerMeetingId}`,null):null;
 if(existingEvidence && (current.summary||!evidence.summary) && (current.recordingUrl||!evidence.recordingUrl))return current;
 const result=await saveRecruiterReview(store,id,{expectedVersion:current.version,recommendation:current.recommendation,notes:current.notes,summary:current.summary||evidence.summary||'',recordingUrl:current.recordingUrl||evidence.recordingUrl||'',salaryExpectation:current.salaryExpectation,availability:current.availability,concerns:current.concerns},{email:actorEmail,userId:'integration',role:'recruiter'});
 // Transcript evidence is separate from editable recruiter feedback and is never candidate-visible.
 if(evidence.providerMeetingId)await store.setSetting(`interview_evidence:${id}:${evidence.providerMeetingId}`,{...evidence,attachedAt:Date.now(),attachedBy:actorEmail});
 return result;
}
export async function assertHiringTransition(store:HubStore,id:string,target:string,member:HubMember){
 if(['Second Round Interview','Offer','Hired'].includes(target)){
  if(!await canApproveHiring(store,member))throw new HiringError('hiring_approval_required',403,'Only the owner or an approved hiring decision-maker can move applicants to this stage.');
  const state=(await notesReviews(store,[id],member.email)).get(id);
  if(!state?.count||state.hasUnread)throw new HiringError('notes_review_required',422,'Read the current interview notes and click Mark reviewed before making this decision.');
 }
 if(target==='Awaiting Founder Review'){
  const review=await getRecruiterReview(store,id);
  if(!review.readiness.ready)throw new HiringError('interview_handoff_incomplete',422,'Complete the founder handoff: '+review.readiness.missing.join(', ')+'.');
 }
}
export async function workflowNotificationStatements(store:HubStore,id:string,eventId:string,now:number){
 const recipients=await workflowApprovers(store);
 return Promise.all(recipients.map(async recipient=>{const taskId='workflow-notice:'+await sha256(eventId+':'+recipient);return store.taskStatement(taskId,id,'gmail',{workflowNotification:true,recipient,eventId,messageId:`<${await sha256(taskId)}@jobs.aicaseleads.com>`},now)}));
}
export async function workflowNotificationMail(task:Task,store:HubStore,owners:string[]=[]):Promise<MailInput|null>{
 const recipient=typeof task.payload.recipient==='string'?task.payload.recipient:'';
 if(!(await workflowApprovers(store,owners)).includes(recipient))return null;
 const app=await store.applicationRow(task.applicationId);
 if(app.stage!=='Awaiting Founder Review')return null;
 const origin=store.options.origin||'https://jobs.aicaseleads.com',url=new URL('/team',origin);url.searchParams.set('view','applications');url.searchParams.set('application',app.id);url.searchParams.set('stage','Awaiting Founder Review');url.searchParams.set('candidateSection','review');
 return {to:recipient,messageId:String(task.payload.messageId),subject:`Founder review ready: ${app.job_title}`,body:`An interview handoff is ready for your review.\n\nOpen the candidate record for the recommendation, notes, recording, interview summary, compensation, availability and concerns:\n${url}\n\nChoose a second interview, return to recruiter, or reject in the hiring workspace.`};
}
export async function workflowOverview(store:HubStore,member:HubMember){
 const canApprove = await canApproveHiring(store,member);
 const newQueue = {stage:'Application Review',sort:'screening_newest' as const};
 const [reviews,mine,unassigned,returned] = await Promise.all([
   store.applications({stage:'Awaiting Founder Review',sort:'newest'},member.email),
   store.applications({...newQueue,assignee:member.email},member.email),
   store.applications({...newQueue,assignee:'unassigned'},member.email),
   store.applications({handoffReturned:true,assignee:canApprove?undefined:member.email,sort:'newest'},member.email),
 ]);
 return {canApprove, approvers:await workflowApprovers(store), reviewQueue:reviews.items.slice(0,12),
   myQueue:mine.items.slice(0,12),unassigned:unassigned.items.slice(0,12),returned:returned.items.slice(0,12),
   counts:{awaitingReview:reviews.total,myUnreviewed:mine.total,unassigned:unassigned.total,returned:returned.total},handoffRequired:HANDOFF_REQUIRED};
}
export async function listRoleInterviews(store:HubStore,filters:{jobId?:string;owner?:string;status?:string;progress?:string;page?:number;pageSize?:number}){
 const page=filters.page??1,pageSize=filters.pageSize??50;
 if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new HiringError('invalid_interview_page',422,'Choose a valid interview page and a page size between 1 and 100.');
 const where=[activeApplicationsSql('a')],values:(string|number|null)[]=[];
 if(filters.jobId){await store.getJob(filters.jobId);where.push('a.job_id=?');values.push(filters.jobId);}
 if(filters.owner){where.push("lower(COALESCE(a.assignee,''))=?");values.push(filters.owner.toLowerCase());}
 // Older applications can be in an interview stage without a scheduling record.
 const joined = 'hub_applications a LEFT JOIN hub_interviews i ON i.application_id=a.id';
 where.push(`(i.id IS NOT NULL OR ${interviewStageWithoutRecordSql})`);
 if (filters.progress) {
  if (!isInterviewFilter(filters.progress))
   throw new HiringError('invalid_interview_filter',422,'Choose a valid interview status.');
  const predicate = sessionFilterPredicate(filters.progress);
  where.push(predicate.sql);
  values.push(...predicate.values);
 }
 if (filters.status) {
  if (filters.status === 'completed') where.push('i.attended=1');
  else if (filters.status === 'upcoming') {
   where.push(interviewSlotPredicate('upcoming'));
  } else {
   if (!['invited','pending','booked','cancel_pending','cancelled','failed'].includes(filters.status))
    throw new HiringError('invalid_interview_filter',422,'Choose a valid interview status.');
   where.push('i.status=?');
   values.push(filters.status);
  }
 }
 const clause = where.join(' AND ');
 const count = await store.stmt(`SELECT COUNT(*) AS n FROM ${joined} WHERE ${clause}`, ...values).first<{n:number}>();
 const startOrder = filters.progress === 'upcoming' || filters.status === 'upcoming' ? 'ASC' : 'DESC';
 const rows = await store.rows<{
   id: string; applicationId: string; name: string; jobId: string; jobTitle: string;
   assignee: string | null; status: string; interviewProgress: InterviewProgress;
   start: string | null; end: string | null; meetUrl: string | null;
 }>(`SELECT COALESCE(i.id, 'unlinked:' || a.id) AS id, a.id AS applicationId,
       a.name, a.job_id AS jobId, a.job_title AS jobTitle, a.assignee,
       COALESCE(i.status, 'unlinked') AS status, (${sessionProgressSql}) AS interviewProgress,
       i.start, i.end, i.meet_url AS meetUrl
     FROM ${joined} WHERE ${clause}
     ORDER BY julianday(i.start) ${startOrder}, COALESCE(i.created_at, a.created_at) DESC, a.id, i.id DESC
     LIMIT ? OFFSET ?`, ...values, pageSize, (page - 1) * pageSize);
 const evidenceRows=rows.length?await store.rows<{value:string}>(`SELECT value FROM hub_settings WHERE ${[...new Set(rows.map(row=>row.applicationId))].map(()=>"key LIKE ?").join(' OR ')}`,...[...new Set(rows.map(row=>row.applicationId))].map(id=>`interview_evidence:${id}:%`)):[];
 const byInterview=new Map<string,{recordingUrl?:string;summary?:string}>();
 for(const item of evidenceRows){try{const evidence=JSON.parse(item.value) as {interviewId?:string;recordingUrl?:string;summary?:string};if(evidence.interviewId)byInterview.set(evidence.interviewId,evidence);}catch{/* Ignore malformed legacy evidence. */}}
 return {items:rows.map(row=>({...row,recordingUrl:byInterview.get(row.id)?.recordingUrl||null,summary:byInterview.get(row.id)?.summary||null})),total:count?.n||0,page,pageSize};
}
