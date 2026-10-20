import { z } from "zod";
import { AUTOMATIC_SENDER as CANDIDATE_SENDER, AUTOMATIC_REPLY_TO } from '../email/contracts';
import { AUTOMATED_MAIL_NOTICE } from "../hiring/receipt-email";
import type { HubStore } from "../hub/store";
import type { Task } from "../hub/types";
import type { MailInput } from "../google/gmail";
import { HiringError } from "../hiring/errors";
import { sha256 } from "../hiring/crypto";

export const teamKey=(jobId:string)=>`job_team:${jobId}`;
const email=z.string().trim().email().transform(value=>value.toLowerCase());
export const teamInputSchema=z.object({members:z.array(email).max(25),replyTo:email.nullable(),notifyNewApplications:z.boolean(),notifyAssessmentSubmissions:z.boolean(),notifyReplies:z.boolean(),notifyOverdueReviews:z.boolean()}).strict();
export type JobTeamInput=z.infer<typeof teamInputSchema>;
export type JobTeamConfig=JobTeamInput&{revision:number;createdAt:number;updatedAt:number};
export const emptyJobTeam:JobTeamInput={members:[],replyTo:null,notifyNewApplications:true,notifyAssessmentSubmissions:true,notifyReplies:true,notifyOverdueReviews:true};
export type Staff={email:string;role:string};
export async function activeJobStaff(store:HubStore,owners:string[]=[]):Promise<Staff[]>{
 const rows=await store.rows<Staff>("SELECT lower(trim(email)) AS email,role FROM hub_members WHERE active=1 AND role IN ('admin','recruiter')");
 const byEmail=new Map(rows.map(person=>[person.email,person]));
 for(const owner of owners){const parsed=email.safeParse(owner);if(parsed.success)byEmail.set(parsed.data,{email:parsed.data,role:"admin"});}
 return [...byEmail.values()];
}
export async function jobTeam(store:HubStore,jobId:string):Promise<JobTeamConfig|null>{return store.setting<JobTeamConfig|null>(teamKey(jobId),null);}
export async function validateTeam(store:HubStore,input:JobTeamInput,owners:string[]=[]){
 const staff=await activeJobStaff(store,owners),members=[...new Set(input.members)];
 if(members.some(member=>!staff.some(person=>person.email===member)))throw new HiringError("invalid_job_team",422,"Choose active managers or recruiters from Team access before assigning this job.");
 if(input.replyTo==="sales@aicaseleads.com")throw new HiringError("invalid_job_reply_to",422,"Choose a recruiter other than the owner for candidate replies.");
 if(input.replyTo&&!members.includes(input.replyTo))throw new HiringError("invalid_job_reply_to",422,"Choose a reply contact from this job's hiring team.");
 return {...input,members};
}
export type JobEvent="newApplication"|"assessmentSubmission"|"reply";
const preference={newApplication:"notifyNewApplications",assessmentSubmission:"notifyAssessmentSubmissions",reply:"notifyReplies"} as const;
// The caller commits these alongside the accepted application/event. Never scan
// historic candidates when changing a team or enabling a notification preference.
export async function jobNotificationStatements(store:HubStore,jobId:string,applicationId:string,event:JobEvent,eventId:string,now:number,eventAt=now){
 const config=await jobTeam(store,jobId);
 if(!config||!config[preference[event]]||eventAt<config.createdAt)return [];
 return Promise.all([...new Set(config.members)].map(async recipient=>{
  const id=`job-notice:${event}:${await sha256(`${eventId}:${recipient}`)}`;
  return store.taskStatement(id,applicationId,"gmail",{jobNotification:true,jobId,event,recipient,messageId:`<${await sha256(id)}@jobs.aicaseleads.com>`},now);
 }));
}
export async function jobNotificationMail(task:Task,store:HubStore,owners:string[]=[]):Promise<MailInput|null>{
 const {jobId,event,recipient,messageId}=task.payload;
 if(typeof jobId!=="string"||typeof recipient!=="string"||typeof messageId!=="string"||typeof event!=="string"||!(event in preference))return null;
 const config=await jobTeam(store,jobId),staff=await activeJobStaff(store,owners);
 if(!config||!config[preference[event as JobEvent]]||!config.members.includes(recipient)||!staff.some(person=>person.email===recipient))return null;
 const app=await store.applicationRow(task.applicationId);
 if(app.job_id!==jobId)return null;
 const label={newApplication:"New application",assessmentSubmission:"Assessment submitted",reply:"Applicant replied"}[event as JobEvent];
 const link=new URL(`/team?view=applications&application=${encodeURIComponent(app.id)}`,store.options.origin||"https://jobs.aicaseleads.com");
 return {to:recipient,messageId,subject:`${label}: ${app.job_title}`,body:`${label} for ${app.job_title}.\n\nReview the application in the hiring dashboard: ${link}\n\nYou received this because you are on this job's hiring team. Managers can change its team and notification settings under Jobs.`};
}
/** Candidate envelopes never inherit private staff routing. */
export { AUTOMATIC_SENDER as CANDIDATE_SENDER } from '../email/contracts';
export async function candidateReplyTo(_store:HubStore,_applicationId:string,_owners:string[]=[]):Promise<string[]>{
 void _store; void _applicationId; void _owners;
 return [AUTOMATIC_REPLY_TO];
}
export async function candidateMail(store:HubStore,input:MailInput,owners:string[]=[],context?:{mailMode?:unknown;actor?:unknown;applicationId:string;rejection?:boolean}):Promise<MailInput>{
 const staff=await store.rows<{email:string}>("SELECT lower(trim(email)) AS email FROM hub_members");
 const connected=await store.setting<string>("google_sender","");
 const privateAddresses=new Set([...staff.map(person=>person.email),...owners,connected].filter(Boolean).map(value=>value.toLowerCase()));
 let replyTo=AUTOMATIC_REPLY_TO;
 if(context?.mailMode==="recruiter"){
  const active=await activeJobStaff(store,owners);
  const eligible=(value:unknown):value is string=>typeof value==="string"&&value.toLowerCase()!=="sales@aicaseleads.com"&&active.some(person=>person.email===value.toLowerCase());
  if(eligible(context.actor))replyTo=context.actor.toLowerCase();
  else {
   const app=await store.applicationRow(context.applicationId),team=await jobTeam(store,app.job_id);
   if(team?.replyTo&&team.members.includes(team.replyTo)&&eligible(team.replyTo))replyTo=team.replyTo;
   else if(eligible(app.assignee))replyTo=app.assignee.toLowerCase();
   else throw new HiringError("recruiter_reply_contact_required",422,"Assign an active recruiter other than the owner as the reply contact before sending.");
  }
 }
 const addresses=`${input.subject} ${input.body}`.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
 if(addresses.some(address=>address.toLowerCase()!==CANDIDATE_SENDER&&address.toLowerCase()!==replyTo&&privateAddresses.has(address.toLowerCase())))throw new HiringError("candidate_mail_exposes_staff_address",422,"Remove staff email addresses from the applicant email template before retrying.");
 // Copy only the supported envelope fields: queued legacy replyTo/sender cannot leak through.
 const shortNotice="This is an automated email. Please do not reply.";
 const body=context?.rejection?input.body.replaceAll(AUTOMATED_MAIL_NOTICE,shortNotice):input.body;
 const notice=context?.rejection?shortNotice:replyTo===AUTOMATIC_REPLY_TO?AUTOMATED_MAIL_NOTICE:"You can reply to this email to contact your recruiter. For application help or privacy requests, visit https://jobs.aicaseleads.com/help.";
 return {to:input.to,subject:input.subject,body:body.includes(notice)?body:`${body}\n\n${notice}`,messageId:input.messageId,sender:replyTo===AUTOMATIC_REPLY_TO?CANDIDATE_SENDER:replyTo,replyTo:[replyTo],candidateMail:true,candidateAccount:replyTo===AUTOMATIC_REPLY_TO?undefined:replyTo};
}
