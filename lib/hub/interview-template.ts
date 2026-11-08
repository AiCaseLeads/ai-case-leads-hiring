import {interviewReplyContact} from './interview-routing';
import type {HubStore} from './store';
import type {HubMember} from './auth';
import {HiringError} from '../hiring/errors';
import {sha256} from '../hiring/crypto';
import {candidateMail} from '../job-team/service';
export const INTERVIEW_VARIABLES=['name','jobTitle','companyName','interviewerName','bookingLink','linkExpiry','senderName'] as const;
export const DEFAULT_INTERVIEW={subject:'Interview invitation: {{jobTitle}}',body:'Hi {{name}},\n\nThank you for applying for {{jobTitle}} at {{companyName}}. We’d like to invite you to an interview with {{interviewerName}}.\n\nChoose an available time using your private booking link:\n{{bookingLink}}\n\nTimes are shown in your local time zone. Your link is available for fourteen days.\n\nIf you have any questions, reply to this email.\n\n{{senderName}}'};
export type InterviewTemplate={subject:string;body:string;version:number;updatedAt?:number;updatedBy?:string};
export function validateInterviewTemplate(subject:unknown,body:unknown){
 if(typeof subject!=='string'||!subject.trim()||subject.length>300||/[\r\n]/.test(subject)||typeof body!=='string'||!body.trim()||body.length>20000)throw new HiringError('invalid_interview_template',422,'Enter a subject and message within the allowed limits.');
 for(const value of [subject,body])for(const match of value.matchAll(/{{\s*([^{}]+?)\s*}}/g))if(!INTERVIEW_VARIABLES.includes(match[1] as typeof INTERVIEW_VARIABLES[number]))throw new HiringError('unknown_template_variable',422,'Use only the supported template variables.');
 if(!body.includes('{{bookingLink}}'))throw new HiringError('booking_link_required',422,'Keep {{bookingLink}} in the invitation so the applicant can choose a time.');
 if(/{{|}}/.test((subject+body).replace(/{{\s*(name|jobTitle|companyName|interviewerName|bookingLink|linkExpiry|senderName)\s*}}/g,'')))throw new HiringError('invalid_template_variable',422,'Check the template variable brackets.');
 return {subject:subject.trim(),body:body.trim()};
}
export async function getInterviewTemplate(store:HubStore):Promise<InterviewTemplate>{return await store.setting<InterviewTemplate>('interview_email_template',{...DEFAULT_INTERVIEW,version:1});}
export async function saveInterviewTemplate(store:HubStore,input:unknown,member:HubMember){
 if(!member.isOwner)throw new HiringError('owner_access_required',403,'Only the owner can change company email defaults.');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new HiringError('invalid_interview_template',422,'Choose a valid default template.');
 const value=input as {subject?:unknown;body?:unknown;version?:unknown;reset?:boolean};const current=await getInterviewTemplate(store);
 if(value.version!==current.version)throw new HiringError('template_changed',409,'The default changed. Reload before saving.');
 const content=validateInterviewTemplate(value.reset?DEFAULT_INTERVIEW.subject:value.subject,value.reset?DEFAULT_INTERVIEW.body:value.body);
 const next={...content,version:current.version+1,updatedAt:Date.now(),updatedBy:member.email};
 const row=await store.stmt('SELECT value FROM hub_settings WHERE key=?','interview_email_template').first<{value:string}>();
 if(row && (JSON.parse(row.value) as InterviewTemplate).version!==value.version)throw new HiringError('template_changed',409,'The default changed. Reload before saving.');
 const saved=await store.stmt('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE hub_settings.value=? RETURNING key','interview_email_template',JSON.stringify(next),next.updatedAt,row?.value||'').first();
 if(!saved)throw new HiringError('template_changed',409,'The default changed. Reload before saving.');return next;
}
export async function interviewMessage(store:HubStore,member:HubMember,applicationId:string,input:{subject?:string;body?:string;templateVersion?:number;interviewerEmail?:string;renew?:boolean},bookingLink='https://jobs.aicaseleads.com/interview/preview-example',expiry='Fourteen days after sending'){
 const app=await store.applicationRow(applicationId),template=await getInterviewTemplate(store);
 if(input.templateVersion!==undefined&&input.templateVersion!==template.version)throw new HiringError('template_changed',409,'The default invitation changed. Refresh your preview before sending.');
 const source=validateInterviewTemplate(input.subject??template.subject,input.body??template.body);
 const values:Record<string,string>={name:app.name,jobTitle:app.job_title,companyName:'AI Case Leads',interviewerName:'our hiring team',bookingLink,linkExpiry:expiry,senderName:'AI Case Leads Hiring Team'};
 const render=(value:string)=>value.replace(/{{\s*([^{}]+?)\s*}}/g,(_,key:string)=>values[key]);
 const renderedSubject=render(source.subject);if(/[\r\n]/.test(renderedSubject))throw new HiringError('invalid_interview_subject',422,'The rendered subject must fit on one line.');
 const interviewerEmail=await interviewReplyContact(store,applicationId,input,(process.env.ADMIN_EMAILS||'').split(','));
 const mail=await candidateMail(store,{to:app.email,subject:renderedSubject,body:render(source.body),messageId:'<interview-preview@jobs.aicaseleads.com>'},(process.env.ADMIN_EMAILS||'').split(','),{mailMode:'recruiter',actor:member.email,applicationId,interview:true,interviewerEmail});
 const envelope={sender:mail.sender,to:mail.to,cc:mail.cc||[],replyTo:mail.replyTo||[]};
 const fingerprint=await sha256(JSON.stringify({applicationId,revision:app.revision,actor:member.email,source,templateVersion:template.version,organizer:interviewerEmail||'',renew:!!input.renew,envelope}));
 return {source,interviewerEmail,applicationRevision:app.revision,templateVersion:template.version,subject:mail.subject,body:mail.body,envelope,fingerprint};
}
