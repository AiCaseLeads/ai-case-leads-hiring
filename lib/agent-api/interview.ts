import {z} from 'zod';
import {authorizeAgent} from './access';
import {AgentReadError} from './errors';
import {sha256} from '../hiring/crypto';
import {HiringError} from '../hiring/errors';
import {applicationTrash} from '../hub/application-lifecycle';
import {activeJobStaff} from '../job-team/service';
import {getInterviewTemplate,prepareInterviewPreview} from '../hub/interview-template';
import {interviewReadiness,assertInterviewReady} from '../hub/interview-readiness';
import {sendInterviewInvitation} from '../hub/interview-delivery';
import type {PersonalMailEnv} from '../personal-mail/service';
import type {HubStore} from '../hub/store';

const schema=z.object({applicationId:z.string().regex(/^app_[a-f0-9]{64}$/),expectedRevision:z.number().int().positive().safe(),interviewerEmail:z.string().email().max(200).transform(s=>s.trim().toLowerCase()),confirm:z.literal(true)}).strict();
/** Explicitly granted interview action; preserves staff routing and identifies the agent in the audit trail. */
export async function requestAgentInterview(store:HubStore,request:Request,input:unknown,env:PersonalMailEnv){
 const access=await authorizeAgent(store,request,'applicants:interview');
 const parsed=schema.safeParse(input);if(!parsed.success)throw new HiringError('invalid_interview_request',422,'Supply applicationId, current expectedRevision, interviewerEmail and confirm=true.');
 const {applicationId,expectedRevision,interviewerEmail}=parsed.data;
 const now=Date.now(),minute=Math.floor(now/60000),key=await sha256('agent-interview:'+access.id+':minute:'+(minute%10));
 const charged=await store.stmt('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<20 RETURNING attempts',key,Math.floor(now/600000)).first();
 if(!charged)throw new AgentReadError('agent_interview_rate_limited',429,'This connection may request at most 20 interviews per minute.',{limit:{requests:20,windowSeconds:60},retryAfterSeconds:Math.max(1,Math.ceil(((minute+1)*60000-now)/1000))});
 if(await applicationTrash(store,applicationId))throw new HiringError('application_unavailable',404,'This application is unavailable.');
 const app=await store.applicationRow(applicationId);
 if(await store.stmt("SELECT 1 FROM hub_interviews WHERE application_id=? UNION ALL SELECT 1 FROM hub_links WHERE application_id=? AND kind='interview' LIMIT 1",applicationId,applicationId).first())return {applicationId,alreadyInvited:true,email:'unchanged'};
 if(app.revision!==expectedRevision)throw new HiringError('record_changed',409,'This application changed. Refresh it before requesting an interview.');
 const staff=await activeJobStaff(store,(env.ADMIN_EMAILS||'').split(','));
 if(!staff.some(person=>person.email===interviewerEmail))throw new HiringError('interviewer_not_active',422,'Choose an active hiring team member as interviewer and sending account.');
 // The selected mailbox is explicit in the request; userId and transactional audit identify the agent, not a signed-in staff session.
 const member={email:interviewerEmail,userId:'agent:'+access.id,role:'recruiter' as const};
 const readiness=await interviewReadiness(store,member,applicationId,env,{interviewerEmail});assertInterviewReady(readiness,{interviewerEmail});
 const template=await getInterviewTemplate(store);
 const draft={subject:template.subject,body:template.body,templateVersion:template.version,interviewerEmail};
 const preview=await prepareInterviewPreview(store,member,applicationId,draft);
 if(preview.applicationRevision!==expectedRevision)throw new HiringError('record_changed',409,'This application changed. Refresh it before requesting an interview.');
 const result=await sendInterviewInvitation(store,member,applicationId,{action:'interview',expectedRevision,...draft,previewFingerprint:preview.fingerprint,bookingToken:preview.bookingToken},env,undefined,{key:'agent_access_'+access.id,value:JSON.stringify(access),name:access.name,kind:'interview'});
 return {applicationId,alreadyInvited:false,interviewerEmail,delivery:result.interviewDelivery};
}
