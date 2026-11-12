import {z} from 'zod';
import {sha256} from '../hiring/crypto';
import {AgentReadError} from './errors';
import {authorizeAgent} from './access';
import {applicationTrash} from '../hub/application-lifecycle';
import {HiringError} from '../hiring/errors';
import type {HubStore} from '../hub/store';

const inputSchema=z.object({applicationId:z.string().regex(/^app_[a-f0-9]{64}$/),expectedRevision:z.number().int().positive().safe(),reason:z.string().trim().min(1).max(2000),confirm:z.literal(true)}).strict();
/** Reject only on a scoped, explicit request. The reason is private; the job template is emailed. */
export async function rejectApplicant(store:HubStore,request:Request,input:unknown){
 const access=await authorizeAgent(store,request,'applicants:reject');
 const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new HiringError('invalid_rejection',422,'Supply applicationId, current expectedRevision, a private reason and confirm=true.');
 const {applicationId,expectedRevision,reason}=parsed.data;
 const now=Date.now(),minute=Math.floor(now/60000),key=await sha256('agent-reject:'+access.id+':minute:'+(minute%10));
 const charged=await store.stmt('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<20 RETURNING attempts',key,Math.floor(now/600000)).first();
 if(!charged){const retryAfterSeconds=Math.max(1,Math.ceil(((minute+1)*60000-now)/1000));throw new AgentReadError('agent_reject_rate_limited',429,'This connection may reject at most 20 applications per minute.',{limit:{requests:20,windowSeconds:60},retryAfterSeconds});}
 if(await applicationTrash(store,applicationId))throw new HiringError('application_unavailable',404,'This application is unavailable.');
 const app=await store.applicationRow(applicationId);
 if(app.stage==='Rejected')return {applicationId,stage:'Rejected',alreadyRejected:true,email:'unchanged'};
 if(await store.stmt("SELECT 1 FROM hub_interviews WHERE application_id=? UNION ALL SELECT 1 FROM hub_links WHERE application_id=? AND used_at IS NULL LIMIT 1",applicationId,applicationId).first())throw new HiringError('application_interview_requires_review',409,'This applicant has an interview or active link; handle the decision in the hiring workspace.');
 if(app.stage!=='Application Review')throw new HiringError('application_stage_requires_review',409,'Only applications awaiting initial review can be rejected through this connection; handle later stages in the hiring workspace.');
 await store.action(applicationId,{action:'reject',expectedRevision,reason},{userId:'agent:'+access.id,email:'agent:'+access.id,role:'recruiter'},{key:'agent_access_'+access.id,value:JSON.stringify(access),name:access.name});
 return {applicationId,stage:'Rejected',alreadyRejected:false,email:'queued'};
}
