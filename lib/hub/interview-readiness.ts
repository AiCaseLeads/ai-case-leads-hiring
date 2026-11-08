import {interviewReplyContact} from './interview-routing';
import type { HubMember } from './auth';
import type { HubStore } from './store';
import { activeJobStaff, candidateMail } from '../job-team/service';
import { personalMailStatus, type PersonalMailEnv } from '../personal-mail/service';
import { interviewCalendar, personalStatus } from '../personal-calendar/service';
import { HiringError } from '../hiring/errors';

/** Read-only preview of the same recruiter routing used by the delivery worker. */
export async function interviewReadiness(store: HubStore, member: HubMember, applicationId: string, env: PersonalMailEnv,input:{interviewerEmail?:string}={}) {
 const owners=(env.ADMIN_EMAILS || '').split(',');
 const app=await store.applicationRow(applicationId);
 let cc:string[]=[],replyTo:string[]=[];
 let interviewerEmail:string|undefined,sender: string | null=null, mailReady=false, mailIssue: string | null=null;
 try {
  interviewerEmail=await interviewReplyContact(store,applicationId,input,owners);
  const envelope=await candidateMail(store,{to:app.email,subject:'Interview invitation',body:'Your private interview booking link.',messageId:'<readiness-preview@jobs.aicaseleads.com>'},owners,{mailMode:'recruiter',actor:member.email,applicationId,interview:true,interviewerEmail});
  sender=envelope.candidateAccount || null;cc=envelope.cc||[];replyTo=envelope.replyTo||[];
  mailReady=!!sender && (await personalMailStatus(store,sender,env)).connected;
  if(!mailReady) mailIssue='recruiter_email_not_connected';
 } catch(error) {
  if(!(error instanceof HiringError) || !['recruiter_reply_contact_required','interviewer_not_active','interview_owner_pinned'].includes(error.code)) throw error;
  mailIssue=error.code;
 }
 const staff=await activeJobStaff(store,[...owners,member.email]);
 const companyGoogleReady=!!store.options.integrations?.google;
 const interviewers=await Promise.all(staff.map(async person=>{const status=await personalStatus(store,person.email);return {email:person.email,ready:companyGoogleReady && status.ready};}));
 const scheduling=await store.scheduling();
 const sharedCalendarReady=!!store.options.integrations?.google && scheduling.configured;
 const current=await store.latestInterview(applicationId);
 let renewCalendarReady=false;
 if(companyGoogleReady && current && current.status!=='cancelled') {
  const pinned=await interviewCalendar(store,current.id);
  if(pinned) {
   const status=await personalStatus(store,pinned.ownerEmail);
   renewCalendarReady=staff.some(person=>person.email===pinned.ownerEmail) && status.ready && status.calendarId===pinned.calendarId;
  } else renewCalendarReady=sharedCalendarReady;
 }
 return {sender,cc,replyTo,...(interviewerEmail?{interviewerEmail}:{}),mailReady,mailIssue,companyGoogleReady,sharedCalendarReady,renewCalendarReady,hasActiveInterview:!!current && current.status!=='cancelled',interviewers};
}

export function assertInterviewReady(readiness:Awaited<ReturnType<typeof interviewReadiness>>,input:{renew?:boolean;interviewerEmail?:string}){
 if(!readiness.mailReady)throw new HiringError('interview_email_setup_required',422,readiness.mailIssue==='interviewer_not_active'?'Choose an active interviewer before sending.':readiness.mailIssue==='interview_owner_pinned'?'Cancel this interview before choosing a different interviewer.':readiness.mailIssue==='recruiter_reply_contact_required'?'Choose an active hiring team reply contact for this job before sending.':'Connect the sending account’s recruiting email in Settings → My calendar & email.');
 if(!readiness.companyGoogleReady)throw new HiringError('interview_company_setup_required',422,'The company Google scheduling connection needs attention.');
 const calendarReady=input.renew?readiness.hasActiveInterview&&readiness.renewCalendarReady:input.interviewerEmail?readiness.interviewers.some(p=>p.email===input.interviewerEmail&&p.ready):readiness.sharedCalendarReady;
 if(!calendarReady)throw new HiringError('interview_calendar_setup_required',422,'Choose a connected interviewer and save interview hours before sending.');
}
