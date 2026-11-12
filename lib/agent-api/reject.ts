import {z} from 'zod';
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
 if(await applicationTrash(store,applicationId))throw new HiringError('application_unavailable',404,'This application is unavailable.');
 const app=await store.applicationRow(applicationId);
 if(app.stage==='Rejected')return {applicationId,stage:'Rejected',alreadyRejected:true,email:'unchanged'};
 if(['Offer','Hired','Withdrawn'].includes(app.stage))throw new HiringError('application_stage_requires_review',409,'This application is in an offer or closed stage; handle it in the hiring workspace.');
 await store.action(applicationId,{action:'reject',expectedRevision,reason},{userId:'agent:'+access.id,email:'agent:'+access.id,role:'recruiter'},{key:'agent_access_'+access.id,value:JSON.stringify(access)});
 return {applicationId,stage:'Rejected',alreadyRejected:false,email:'queued'};
}
