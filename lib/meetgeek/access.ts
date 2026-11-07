import type {HubMember} from '../hub/auth-core';
import type {Meeting} from './client';
import {HiringError} from '../hiring/errors';
const normalized=(emails:unknown[])=>emails.filter((v):v is string=>typeof v==='string').map(v=>v.trim().toLowerCase());
export function mayDiscoverMeeting(record:{applicationId:string|null;participantEmails:string[]},member:HubMember){return !!record.applicationId||member.role==='admin'||normalized(record.participantEmails||[]).includes(member.email.toLowerCase());}
export function assertManualMeetingAttachment(meeting:Meeting,candidateEmail:string,member?:HubMember){
 if(!member)throw new HiringError('meetgeek_attachment_forbidden',403,'Choose a recording from an interview you attended.');
 if(member.role==='admin')return;
 const participants=normalized(meeting.participant_emails||[]);
 if(!participants.includes(member.email.toLowerCase()))throw new HiringError('meetgeek_attachment_forbidden',403,'Only a participating recruiter or manager can attach this meeting.');
 if(!participants.includes(candidateEmail.toLowerCase().trim()))throw new HiringError('meetgeek_candidate_mismatch',422,'This meeting does not include the applicant’s email. Ask a manager to verify aliases and attach it.');
}

export function assertUnmaskedApiKey(value:string){if(/[*•]/.test(value))throw new HiringError('masked_meetgeek_key',422,'This is a masked API key. Use MeetGeek’s Copy API key control and paste the complete key.');}
