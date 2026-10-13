import { GoogleClient } from "../google/client";
import { WorkspaceCalendar } from "../google/calendar";
import { openToken } from "../google/oauth";
import { configurationFingerprint } from "../google/config-state";
import { HiringError } from "../hiring/errors";
import type { HubStore } from "../hub/store";
import { grantKey,requireActiveInterviewer,type PersonalGrant,type InterviewCalendar } from "./service";
type ClientEnv={GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;GOOGLE_TOKEN_KEY?:string;GOOGLE_CLIENT_REVISION?:number;EXPECTED_RECRUITING_EMAIL?:string};
export async function personalCalendarClient(store:HubStore,snapshot:InterviewCalendar,env:ClientEnv,fetcher:typeof fetch=fetch,deadline?:number){
 const grant=await store.setting<PersonalGrant|null>(grantKey(snapshot.ownerEmail),null);
 if(!grant||grant.email!==snapshot.ownerEmail||grant.calendarId!==snapshot.calendarId||grant.revision!==(env.GOOGLE_CLIENT_REVISION??0)||grant.fingerprint!==await configurationFingerprint(env)||!env.GOOGLE_TOKEN_KEY||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw new HiringError("personal_calendar_reconnect_required",503,"The interviewer must reconnect their own calendar. The shared calendar has not been substituted.");
 const client=new GoogleClient({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,refreshToken:await openToken(grant.sealedToken,env.GOOGLE_TOKEN_KEY)},fetcher);
 client.budget.deadline=deadline;
 return new WorkspaceCalendar(client,snapshot.calendarId);
}
export async function personalCalendarEffect(store:HubStore,snapshot:InterviewCalendar,payload:import("../google/calendar").InterviewInput&{operation:string;interviewId:string},env:ClientEnv,fetcher:typeof fetch=fetch,deadline?:number):Promise<Record<string,unknown>>{
 if(payload.calendarId!==snapshot.calendarId)throw new HiringError("interview_calendar_identity_mismatch",503,"The interview calendar identity changed.");
 if(payload.operation!=="cancel")await requireActiveInterviewer(store,snapshot.ownerEmail);
 const calendar=await personalCalendarClient(store,snapshot,env,fetcher,deadline);
 if(payload.operation==="cancel"){await calendar.cancel(payload.id||payload.interviewId,snapshot.calendarId);return {cancelled:true};}
 if(!["create","update"].includes(payload.operation))throw new HiringError("invalid_calendar_operation",422,"The interview operation is not supported.");
 return {...await (payload.operation==="update"?calendar.update(payload):calendar.create(payload))};
}
