import assert from "node:assert/strict";
import test from "node:test";
import { createStore,RECRUITER,MANAGER,GOOGLE_READY,jobInput,applicationInput,currentAction } from "./fixtures";
import { handlePersonalCalendar } from "../../lib/personal-calendar/http";
import { defaultAvailability,grantKey,availabilityKey,interviewCalendar,personalStatus } from "../../lib/personal-calendar/service";
import { personalCalendarClient,personalCalendarEffect } from "../../lib/personal-calendar/client";
import { savePersonalGrant } from "../../lib/personal-calendar/oauth";
import { configurationFingerprint,claimOAuthBinding } from "../../lib/google/config-state";
import { PERSONAL_CALENDAR_SCOPES,exchangeCalendarCode,openToken,sealToken,authorizationUrl } from "../../lib/google/oauth";
import { availableSlots,handleCandidateRequest } from "../../lib/hub/candidate";
import { calendarEventId } from "../../lib/google/calendar";
import { sha256 } from "../../lib/hiring/crypto";
const origin="https://jobs.example.invalid",tokenKey="ab".repeat(32),env={GOOGLE_CLIENT_ID:"client",GOOGLE_CLIENT_SECRET:"secret",GOOGLE_TOKEN_KEY:tokenKey,GOOGLE_CLIENT_REVISION:0};
const response=(data:unknown)=>Response.json(data);
const google=(email=RECRUITER.email,verified=true,scopes:string=PERSONAL_CALENDAR_SCOPES.join(" ")):typeof fetch=>async input=>String(input)==="https://oauth2.googleapis.com/token"?response({access_token:"access",refresh_token:"personal-refresh",token_type:"Bearer",expires_in:3600,scope:scopes}):response({email,verified_email:verified});
function request(method="GET",body?:unknown){return new Request(`${origin}/api/personal-calendar`,{method,headers:{origin,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});}
async function fixture(){const f=createStore({origin,integrations:GOOGLE_READY});f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,'recruiter',1,0,0)").run(RECRUITER.userId,RECRUITER.email);return f;}
async function connect(f:Awaited<ReturnType<typeof fixture>>){await f.store.setSetting(grantKey(RECRUITER.email),{email:RECRUITER.email,calendarId:RECRUITER.email,sealedToken:await sealToken("personal-refresh",tokenKey),revision:0,fingerprint:await configurationFingerprint(env),connectedAt:Date.now()});await f.store.setSetting(availabilityKey(RECRUITER.email),defaultAvailability);}
test("personal setup is private, recruiter-owned, hides tokens, validates hours and never replaces company settings",async()=>{
 const f=await fixture();await f.store.setSetting("google_sender",MANAGER.email);await f.store.setSetting("google_refresh_token","company-encrypted");await connect(f);
 assert.equal((await handlePersonalCalendar(request(),null,f.store)).status,403);
 const saved=await handlePersonalCalendar(request("PUT",{availability:{...defaultAvailability,timeZone:"Europe/Madrid"},email:MANAGER.email}),RECRUITER,f.store,[MANAGER.email]);assert.equal(saved.status,200);
 const raw=await saved.text();assert.ok(!raw.includes("sealedToken")&&!raw.includes("personal-refresh")&&!raw.includes("fingerprint"));
 assert.equal((await personalStatus(f.store,RECRUITER.email)).availability.timeZone,"Europe/Madrid");assert.equal(await f.store.setting(availabilityKey(MANAGER.email),null),null);
 assert.equal(await f.store.setting("google_refresh_token",""),"company-encrypted");assert.equal(await f.store.setting("google_sender",""),MANAGER.email);
 assert.equal((await handlePersonalCalendar(request("PUT",{availability:{...defaultAvailability,endHour:1}}),RECRUITER,f.store)).status,422);
 f.database.close();
});
test("calendar OAuth requests only calendar plus verified email and rejects missing permissions/unverified identity",async()=>{
 const url=new URL(authorizationUrl({clientId:"client",redirectUri:`${origin}/api/google/callback`,state:"a".repeat(64),scopes:PERSONAL_CALENDAR_SCOPES,codeChallenge:"a".repeat(43)}));
 assert.ok(!url.searchParams.get("scope")!.match(/gmail|drive/));assert.equal(url.searchParams.get("code_challenge_method"),"S256");
 const input={clientId:"client",clientSecret:"secret",code:"code",codeVerifier:"a".repeat(64),redirectUri:`${origin}/api/google/callback`};
 assert.equal((await exchangeCalendarCode(input,google())).email,RECRUITER.email);
 await assert.rejects(exchangeCalendarCode(input,google(RECRUITER.email,false)),/google_profile_invalid/);
 await assert.rejects(exchangeCalendarCode(input,google(RECRUITER.email,true,PERSONAL_CALENDAR_SCOPES[0])),/missing_permissions/);
});
test("OAuth callback states reject cross-user/expired/replayed consent; grant account must match staff and company flow cannot substitute",async()=>{
 const f=await fixture(),state="a".repeat(64),now=Date.now(),binding={flow:"personal-calendar" as const,email:RECRUITER.email,verifier:"b".repeat(64),revision:0,fingerprint:await configurationFingerprint(env)};
 f.database.prepare("INSERT INTO hub_oauth_states(state_hash,user_id,verifier,expires_at,used_at) VALUES (?,?,?,?,NULL)").run(await sha256(state),RECRUITER.userId,JSON.stringify(binding),now+60000);
 await assert.rejects(claimOAuthBinding(f.db,state,MANAGER.userId,now),/oauth_expired/);
 const claimed=await claimOAuthBinding(f.db,state,RECRUITER.userId,now);
 await assert.rejects(claimOAuthBinding(f.db,state,RECRUITER.userId,now),/oauth_expired/);
 const input={...claimed,member:RECRUITER,clientId:"client",clientSecret:"secret",tokenKey,redirectUri:`${origin}/api/google/callback`,code:"code"};
 await assert.rejects(savePersonalGrant(f.db,input,google(MANAGER.email)),/wrong_calendar_account/);
 await assert.rejects(savePersonalGrant(f.db,{...input,binding:{...binding,flow:undefined}},google()),/wrong_calendar_account/);
 await savePersonalGrant(f.db,input,google());
 const grant=await f.store.setting<{sealedToken:string}>(grantKey(RECRUITER.email),{sealedToken:""});assert.equal(await openToken(grant.sealedToken,tokenKey),"personal-refresh");assert.equal(await f.store.setting("google_refresh_token",null),null);
 await f.store.setSetting("google_client_revision",1);await assert.rejects(savePersonalGrant(f.db,input,google()));
 f.database.close();
});
test("personal interviewer owns immutable invite, availability and calendar identity; changes never fall back to shared",async()=>{
 const f=await fixture();await connect(f);const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
 await currentAction(f.store,app.id,{action:"interview",interviewerEmail:RECRUITER.email},MANAGER);
 const interview=(await f.store.getApplication(app.id)).interview!,snapshot=await interviewCalendar(f.store,interview.id);assert.equal(snapshot?.ownerEmail,RECRUITER.email);assert.equal(interview.calendarId,RECRUITER.email);
 await f.store.setSetting(availabilityKey(RECRUITER.email),{...defaultAvailability,timeZone:"Asia/Tokyo"});await f.store.setSetting("google_calendar_id","changed-shared");
 assert.equal((await interviewCalendar(f.store,interview.id))!.availability.timeZone,"America/Bogota");
 let calls=0;const slots=await availableSlots(f.store,{busy:async()=>{throw new Error("must not use shared");},personalBusy:async(owner,range)=>{assert.equal(owner.ownerEmail,RECRUITER.email);assert.deepEqual(range.calendarIds,[RECRUITER.email]);calls++;return [];}},interview.id,RECRUITER.email);assert.ok(slots.length);assert.equal(calls,1);
 await assert.rejects(availableSlots(f.store,{busy:async()=>[]},interview.id,RECRUITER.email),/unavailable/);
 await assert.rejects(availableSlots(f.store,{personalBusy:async()=>{throw new Error("revoked");},busy:async()=>[]},interview.id,RECRUITER.email),/could not be checked/);
 await assert.rejects(currentAction(f.store,app.id,{action:"interview",renew:true,interviewerEmail:MANAGER.email},MANAGER),{code:"interview_owner_pinned"});
 f.database.prepare("UPDATE hub_members SET active=0 WHERE email=?").run(RECRUITER.email);
 await assert.rejects(availableSlots(f.store,{personalBusy:async()=>[]},interview.id,RECRUITER.email),{code:"interviewer_not_active"});
 const client=await personalCalendarClient(f.store,snapshot!,env,async()=>{throw new Error("not called for setup");});assert.ok(client);
 await f.store.setSetting(grantKey(RECRUITER.email),null);await assert.rejects(personalCalendarClient(f.store,snapshot!,env),{code:"personal_calendar_reconnect_required"});f.database.close();
});
test("candidate booking and cancellation retain personal calendar and one reservation",async()=>{
 const f=await fixture();await connect(f);const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));await currentAction(f.store,app.id,{action:"interview",interviewerEmail:RECRUITER.email},MANAGER);
 const mail=(await f.store.tasks()).find(t=>t.kind==="gmail"&&t.id.includes(":interview:"))!;const token=String(mail.payload.body).match(/\/interview\/([a-f0-9]+)/)![1];
 const hooks={personalBusy:async()=>[]};const url=`${origin}/api/candidate/${token}`;
 const info=await (await handleCandidateRequest(new Request(url),token,f.store,hooks)).json() as {data:{slots:{start:string}[]}};assert.ok(info.data.slots.length);
 const post=(body:unknown)=>new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
 const booked=await handleCandidateRequest(post({action:"book",start:info.data.slots[0].start,timeZone:"America/Bogota"}),token,f.store,hooks);assert.equal(booked.status,202,await booked.clone().text());
 const task=(await f.store.tasks()).find(t=>t.kind==="calendar")!;assert.equal(task.payload.calendarId,RECRUITER.email);
 const interview=(await f.store.getApplication(app.id)).interview!;f.database.prepare("UPDATE hub_interviews SET status='booked',provider_id='event' WHERE id=?").run(interview.id);
 f.database.prepare("UPDATE hub_members SET active=0 WHERE email=?").run(RECRUITER.email);
 const cancelled=await handleCandidateRequest(post({action:"cancel"}),token,f.store,hooks);assert.equal(cancelled.status,202,await cancelled.clone().text());
 const cancel=(await f.store.tasks()).find(t=>t.kind==="calendar"&&t.payload.operation==="cancel")!;assert.equal(cancel.payload.calendarId,RECRUITER.email);assert.equal((await interviewCalendar(f.store,interview.id))?.ownerEmail,RECRUITER.email);f.database.close();
});

test("calendar create, reschedule and cancel use the pinned recruiter token and calendar after reconnect",async()=>{
 const f=await fixture();await connect(f);const snapshot={ownerEmail:RECRUITER.email,calendarId:RECRUITER.email,availability:defaultAvailability};
 const payload={operation:"create",id:"synthetic-interview",interviewId:"synthetic-interview",calendarId:RECRUITER.email,title:"Synthetic interview",email:"candidate@example.invalid",start:"2030-01-07T15:00:00Z",end:"2030-01-07T15:30:00Z",timeZone:"America/Bogota"};
 const eventId=await calendarEventId(payload.id);let event:Record<string,unknown>|null=null;const methods:string[]=[];
 const provider:typeof fetch=async(input,init={})=>{
  const url=String(input),method=init.method??"GET";
  if(url==="https://oauth2.googleapis.com/token"){assert.equal(new URLSearchParams(String(init.body)).get("refresh_token"),"personal-refresh");return response({access_token:"personal-access",token_type:"Bearer",expires_in:3600});}
  assert.equal(new Headers(init.headers).get("Authorization"),"Bearer personal-access");
  if(url.endsWith("/freeBusy"))return response({calendars:{[RECRUITER.email]:{busy:[]}}});
  assert.ok(url.includes(`/calendars/${encodeURIComponent(RECRUITER.email)}/events`));methods.push(method);
  if(method==="DELETE"){event={...event,status:"cancelled"};return new Response(null,{status:204});}
  if(method==="POST"||method==="PATCH"){event={...event,...JSON.parse(String(init.body)),id:eventId,etag:"etag",hangoutLink:"https://meet.google.com/test-call",extendedProperties:{private:{aclInterviewId:eventId}}};return response(event);}
  if(url.includes("timeMin="))return response({items:[]});
  return event?response(event):new Response(null,{status:404});
 };
 await personalCalendarEffect(f.store,snapshot,payload,env,provider);
 await connect(f); // Same-account reconnect leaves the event identity intact.
 await personalCalendarEffect(f.store,snapshot,{...payload,operation:"update",start:"2030-01-07T16:00:00Z",end:"2030-01-07T16:30:00Z"},env,provider);
 f.database.prepare("UPDATE hub_members SET active=0 WHERE email=?").run(RECRUITER.email);
 const before=methods.length;
 await assert.rejects(personalCalendarEffect(f.store,snapshot,payload,env,provider),{code:"interviewer_not_active"});
 await assert.rejects(personalCalendarEffect(f.store,snapshot,{...payload,operation:"update"},env,provider),{code:"interviewer_not_active"});
 assert.equal(methods.length,before);
 await personalCalendarEffect(f.store,snapshot,{...payload,operation:"cancel"},env,provider);
 assert.ok(methods.includes("POST")&&methods.includes("PATCH")&&methods.includes("DELETE"));
 await assert.rejects(personalCalendarEffect(f.store,snapshot,{...payload,calendarId:MANAGER.email},env,provider),{code:"interview_calendar_identity_mismatch"});
 f.database.close();
});

test("personal readiness detects credential fingerprint changes and offline consent is not ready until hours saved",async()=>{
 const f=await fixture();await connect(f);
 assert.equal((await personalStatus(f.store,RECRUITER.email)).ready,true);
 f.store.options.googleFingerprint="changed-credentials";
 assert.equal((await personalStatus(f.store,RECRUITER.email)).connected,false);
 assert.equal((await personalStatus(f.store,RECRUITER.email)).ready,false);
 f.store.options.googleFingerprint=await configurationFingerprint(env);await f.store.setSetting(availabilityKey(RECRUITER.email),null);
 assert.equal((await personalStatus(f.store,RECRUITER.email)).connected,true);assert.equal((await personalStatus(f.store,RECRUITER.email)).ready,false);f.database.close();
});
