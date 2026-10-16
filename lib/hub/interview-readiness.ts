import type { HubMember } from './auth';
import type { HubStore } from './store';
import { activeJobStaff, candidateMail } from '../job-team/service';
import { personalMailStatus, type PersonalMailEnv } from '../personal-mail/service';
import { interviewCalendar, personalStatus } from '../personal-calendar/service';
import { HiringError } from '../hiring/errors';

/** Read-only preview of the same recruiter routing used by the delivery worker. */
export async function interviewReadiness(store: HubStore, member: HubMember, applicationId: string, env: PersonalMailEnv) {
 const owners=(env.ADMIN_EMAILS || '').split(',');
 const app=await store.applicationRow(applicationId);
 let sender: string | null=null, mailReady=false, mailIssue: string | null=null;
 try {
  const envelope=await candidateMail(store,{to:app.email,subject:'Interview invitation',body:'Your private interview booking link.',messageId:'<readiness-preview@jobs.aicaseleads.com>'},owners,{mailMode:'recruiter',actor:member.email,applicationId});
  sender=envelope.candidateAccount || null;
  mailReady=!!sender && (await personalMailStatus(store,sender,env)).connected;
  if(!mailReady) mailIssue='recruiter_email_not_connected';
 } catch(error) {
  if(!(error instanceof HiringError) || error.code!=='recruiter_reply_contact_required') throw error;
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
 return {sender,mailReady,mailIssue,companyGoogleReady,sharedCalendarReady,renewCalendarReady,hasActiveInterview:!!current && current.status!=='cancelled',interviewers};
}
