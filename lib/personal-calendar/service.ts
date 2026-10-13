import { z } from "zod";
import type { HubStore } from "../hub/store";
import { activeJobStaff } from "../job-team/service";
import { HiringError } from "../hiring/errors";
import type { Scheduling } from "../hub/types";
export const grantKey=(email:string)=>`personal_calendar_grant:${email.toLowerCase()}`;
export const availabilityKey=(email:string)=>`personal_calendar_availability:${email.toLowerCase()}`;
export const interviewCalendarKey=(id:string)=>`interview_calendar:${id}`;
export const availabilitySchema=z.object({timeZone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}},"Choose a valid time zone"),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(values=>[...new Set(values)]),startHour:z.number().int().min(0).max(23),endHour:z.number().int().min(1).max(24),durationMinutes:z.union([z.literal(15),z.literal(30),z.literal(45),z.literal(60)]),minimumNoticeHours:z.number().int().min(2).max(168).default(2),horizonDays:z.number().int().min(1).max(30).default(14)}).strict().refine(value=>value.endHour>value.startHour,"End time must follow start time");
export type Availability=z.infer<typeof availabilitySchema>;
export const defaultAvailability:Availability={timeZone:"America/Bogota",weekdays:[1,2,3,4,5],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14};
export type PersonalGrant={email:string;calendarId:string;sealedToken:string;revision:number;fingerprint:string;connectedAt:number};
export type InterviewCalendar={ownerEmail:string;calendarId:string;availability:Availability};
export async function personalStatus(store:HubStore,email:string){
 const grant=await store.setting<PersonalGrant|null>(grantKey(email),null),availability=await store.setting<Availability|null>(availabilityKey(email),null);
 const revision=await store.setting("google_client_revision",0);
 const connected=!!grant&&grant.email===email.toLowerCase()&&grant.revision===revision;
 return {email:email.toLowerCase(),connected,ready:connected&&!!availability,calendarId:grant?.calendarId??null,availability:availability??defaultAvailability};
}
export async function personalCalendarSnapshot(store:HubStore,email:string,owners:string[]=[]):Promise<InterviewCalendar>{
 email=email.toLowerCase();
 if(!(await activeJobStaff(store,owners)).some(person=>person.email===email))throw new HiringError("interviewer_not_active",422,"Choose an active recruiter or manager.");
 const status=await personalStatus(store,email);
 if(!status.ready||!status.calendarId)throw new HiringError("personal_calendar_not_ready",422,"Ask this interviewer to connect their calendar and save availability in My calendar first.");
 return {ownerEmail:email,calendarId:status.calendarId,availability:status.availability};
}
export async function interviewCalendar(store:HubStore,id?:string):Promise<InterviewCalendar|null>{return id?store.setting<InterviewCalendar|null>(interviewCalendarKey(id),null):null;}
export function personalScheduling(snapshot:InterviewCalendar):Scheduling{return {...snapshot.availability,configured:true,remindersEnabled:false};}
