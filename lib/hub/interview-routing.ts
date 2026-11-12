import type {HubStore} from './store';
import {interviewCalendar} from '../personal-calendar/service';
import {activeJobStaff} from '../job-team/service';
import {HiringError} from '../hiring/errors';

/** Personal invitations keep the same organizer when replaced. The selected
 * interviewer's connected Gmail sends the invitation and receives replies. */
export async function interviewReplyContact(store:HubStore,applicationId:string,input:{interviewerEmail?:string},owners:string[]){
 const current=await store.currentInterviewForInvitation(applicationId);
 const pinned=current&&current.status!=='cancelled'?await interviewCalendar(store,current.id):null;
 if(current&&current.status!=='cancelled'&&input.interviewerEmail&&input.interviewerEmail!==pinned?.ownerEmail)throw new HiringError('interview_owner_pinned',409,'Cancel this interview before choosing a different interviewer.');
 const selected=pinned?.ownerEmail||input.interviewerEmail;
 if(selected&&!(await activeJobStaff(store,owners)).some(person=>person.email===selected))throw new HiringError('interviewer_not_active',422,'Choose an active interviewer before sending.');
 return selected;
}
