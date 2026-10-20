import assert from 'node:assert/strict';
import test from 'node:test';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER} from './fixtures';
import {interviewReadiness} from '../../lib/hub/interview-readiness';
import {teamKey} from '../../lib/job-team/service';
import {mailGrantKey} from '../../lib/personal-mail/service';
import {configurationFingerprint} from '../../lib/google/config-state';
const env={GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_TOKEN_KEY:'a'.repeat(64),GOOGLE_CLIENT_REVISION:0,ADMIN_EMAILS:'sales@aicaseleads.com'};
async function fixture(){const f=createStore({integrations:{google:true,drive:true,applicationsEnabled:true}});const job=await f.store.saveJob(jobInput());const {id}=await f.store.acceptApplication(applicationInput(job.id));await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,?,1,0,0)",'recruiter',RECRUITER.email,'recruiter').run();return {...f,id,job};}
async function grant(store:ReturnType<typeof createStore>['store'],email:string){await store.setSetting(mailGrantKey(email),{email,sealedToken:'never-return-this',revision:0,fingerprint:await configurationFingerprint(env),connectedAt:1});}
test('readiness follows effective recruiter contact instead of owner or unrelated candidate mailbox',async()=>{
 const f=await fixture();await grant(f.store,RECRUITER.email);
 await f.store.setSetting(teamKey(f.job.id),{members:[RECRUITER.email],replyTo:RECRUITER.email,revision:1});
 const owner={...MANAGER,email:'sales@aicaseleads.com'};
 const result=await interviewReadiness(f.store,owner,f.id,env);
 assert.deepEqual(result.cc,[owner.email]);assert.deepEqual(result.replyTo,[RECRUITER.email,owner.email]);
 assert.equal(result.sender,RECRUITER.email);assert.equal(result.mailReady,true);assert.equal(result.mailIssue,null);
 assert.ok(!JSON.stringify(result).includes('never-return-this'));
 assert.equal((await f.store.getApplication(f.id)).stage,'Application Review');
 assert.equal((await f.store.getApplication(f.id)).interviews.length,0);
 f.database.close();
});
test('missing reply contact and disconnected recruiter are actionable readiness states',async()=>{
 const f=await fixture();const owner={...MANAGER,email:'sales@aicaseleads.com'};
 const missing=await interviewReadiness(f.store,owner,f.id,env);
 assert.equal(missing.mailIssue,'recruiter_reply_contact_required');assert.equal(missing.mailReady,false);assert.equal(missing.sender,null);
 const disconnected=await interviewReadiness(f.store,RECRUITER,f.id,env);
 assert.equal(disconnected.sender,RECRUITER.email);assert.equal(disconnected.mailReady,false);assert.equal(disconnected.mailIssue,'recruiter_email_not_connected');
 await grant(f.store,RECRUITER.email);
 await f.store.setSetting('google_client_revision',1);
 const configChanged=await interviewReadiness(f.store,RECRUITER,f.id,{...env,GOOGLE_CLIENT_REVISION:1});
 assert.equal(configChanged.mailReady,false);
 f.database.close();
});
test('replacement invitation requires the pinned organizer to remain active and connected',async()=>{
 const f=await fixture();await grant(f.store,RECRUITER.email);
 const calendar={email:RECRUITER.email,calendarId:'calendar-one',sealedToken:'never-return-calendar-token',revision:0,fingerprint:'fixture',connectedAt:1};
 await f.store.setSetting(`personal_calendar_grant:${RECRUITER.email}`,calendar);
 await f.store.setSetting(`personal_calendar_availability:${RECRUITER.email}`,{timeZone:'UTC',weekdays:[1],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14});
 await f.store.stmt("INSERT INTO hub_interviews(id,application_id,status,created_at,updated_at) VALUES (?,?,'invited',1,1)",'interview1',f.id).run();
 await f.store.setSetting('interview_calendar:interview1',{ownerEmail:RECRUITER.email,calendarId:calendar.calendarId,availability:{}});
 assert.equal((await interviewReadiness(f.store,RECRUITER,f.id,env)).renewCalendarReady,true);
 await f.store.setSetting(`personal_calendar_grant:${RECRUITER.email}`,null);
 const disconnected=await interviewReadiness(f.store,RECRUITER,f.id,env);
 assert.equal(disconnected.renewCalendarReady,false);assert.equal(disconnected.hasActiveInterview,true);
 await f.store.setSetting(`personal_calendar_grant:${RECRUITER.email}`,calendar);
 await f.store.stmt("UPDATE hub_members SET active=0 WHERE email=?",RECRUITER.email).run();
 assert.equal((await interviewReadiness(f.store,{...MANAGER,email:'sales@aicaseleads.com'},f.id,env)).renewCalendarReady,false);
 f.database.close();
});
test('company Google prerequisite also gates personal calendars and replacement invitations',async()=>{
 const f=await fixture();await grant(f.store,RECRUITER.email);
 await f.store.setSetting(`personal_calendar_grant:${RECRUITER.email}`,{email:RECRUITER.email,calendarId:'calendar-one',sealedToken:'never-return-calendar-token',revision:0,fingerprint:'fixture',connectedAt:1});
 await f.store.setSetting(`personal_calendar_availability:${RECRUITER.email}`,{timeZone:'UTC',weekdays:[1],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14});
 await f.store.stmt("INSERT INTO hub_interviews(id,application_id,status,created_at,updated_at) VALUES (?,?,'invited',1,1)",'interview1',f.id).run();
 await f.store.setSetting('interview_calendar:interview1',{ownerEmail:RECRUITER.email,calendarId:'calendar-one',availability:{}});
 f.store.options.integrations={google:false,drive:true,applicationsEnabled:true};
 const status=await interviewReadiness(f.store,RECRUITER,f.id,env);
 assert.equal(status.mailReady,true);assert.equal(status.companyGoogleReady,false);assert.equal(status.sharedCalendarReady,false);assert.equal(status.renewCalendarReady,false);assert.ok(status.interviewers.every(person=>!person.ready));
 f.database.close();
});
