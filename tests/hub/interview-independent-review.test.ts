import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,RECRUITER} from './fixtures';
import {DEFAULT_INTERVIEW,interviewMessage} from '../../lib/hub/interview-template';
test('selected interviewer owns the invitation envelope even when another recruiter sends it',async()=>{const f=createStore();try{const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));for(const [id,address]of [['recruiter',RECRUITER.email],['owner','sales@aicaseleads.com']])await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",id,address,'admin').run();const preview=await interviewMessage(f.store,RECRUITER,app.id,{...DEFAULT_INTERVIEW,templateVersion:1,interviewerEmail:'sales@aicaseleads.com'});assert.ok(!preview.body.includes('sales@aicaseleads.com'));assert.equal(preview.envelope.sender,'sales@aicaseleads.com');assert.deepEqual(preview.envelope.replyTo,['sales@aicaseleads.com']);assert.deepEqual(preview.envelope.cc,['sales@aicaseleads.com']);}finally{f.database.close()}});

test('a valid edited invitation with punctuation after the booking variable is actually sent',async()=>{const f=createStore();try{
 const {currentAction,approveScheduling}=await import('./fixtures');const {processHubTasks}=await import('../../lib/task-runner');
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",RECRUITER.userId,RECRUITER.email,'recruiter').run();await approveScheduling(f.store);await f.store.stmt("UPDATE hub_tasks SET status='done'").run();
 const input={subject:'Interview',body:'Hi {{name}}, choose a time ({{bookingLink}}).',templateVersion:1};const preview=await interviewMessage(f.store,RECRUITER,app.id,input);await currentAction(f.store,app.id,{action:'interview',...input,previewFingerprint:preview.fingerprint},RECRUITER);
 let sends=0;await processHubTasks(f.store,f.db,undefined,undefined,3,[],async()=>({setDeadline:()=>{},sendMail:async()=>{sends++;return {id:'synthetic-sent',threadId:'synthetic-thread'}}}) as never);assert.equal(sends,1,'Valid edited invitation must not silently become a stale/expired task');
 }finally{f.database.close()}});

test('queued preview-approved invitation fails closed if its sender loses membership before worker delivery',async()=>{const f=createStore();try{
 const {currentAction,approveScheduling}=await import('./fixtures');const {teamKey}=await import('../../lib/job-team/service');const {processHubTasks}=await import('../../lib/task-runner');
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id)),owner={email:'sales@aicaseleads.com',userId:'owner',isOwner:true,role:'admin' as const},replacement='replacement@example.invalid';
 for(const [id,email]of [['owner',owner.email],['recruiter',RECRUITER.email],['replacement',replacement]])await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",id,email,'admin').run();
 await f.store.setSetting(teamKey(job.id),{members:[RECRUITER.email,replacement],replyTo:RECRUITER.email});await approveScheduling(f.store);await f.store.stmt("UPDATE hub_tasks SET status='done'").run();const input={...DEFAULT_INTERVIEW,templateVersion:1};const preview=await interviewMessage(f.store,owner,app.id,input);await currentAction(f.store,app.id,{action:'interview',...input,previewFingerprint:preview.fingerprint},owner);
 await f.store.stmt("UPDATE hub_members SET active=0 WHERE email=?",owner.email).run();let sends=0;await processHubTasks(f.store,f.db,undefined,undefined,3,[],async()=>({setDeadline:()=>{},sendMail:async()=>{sends++;return {id:'must-not-send'}}}) as never);assert.equal(sends,0);const task=await f.store.stmt("SELECT status,last_error,run_after,attempts,result_json FROM hub_tasks WHERE id LIKE ?",`gmail:${app.id}:interview:%`).first<{status:string;last_error:string;run_after:number;attempts:number;result_json:string}>();assert.equal(task?.status,'failed');assert.equal(task?.last_error,'recruiter_reply_contact_required');assert.equal(task?.run_after,Number.MAX_SAFE_INTEGER);assert.equal(JSON.parse(task!.result_json).retryRequiresReview,true);
 await f.store.stmt("UPDATE hub_members SET active=1 WHERE email=?",owner.email).run();await processHubTasks(f.store,f.db,undefined,undefined,3,[],async()=>({setDeadline:()=>{},sendMail:async()=>{sends++;return {id:'must-not-send'}}}) as never);assert.equal(sends,0,'Restoring routing cannot automatically release historical approved mail');const held=await f.store.stmt('SELECT attempts,run_after FROM hub_tasks WHERE id LIKE ?',`gmail:${app.id}:interview:%`).first<{attempts:number;run_after:number}>();assert.equal(held?.attempts,task?.attempts);assert.equal(held?.run_after,Number.MAX_SAFE_INTEGER);
 }finally{f.database.close()}});


test('inactive selected interviewer holds queued mail across reactivation until explicitly reviewed recovery',async()=>{const f=createStore();try{
 const {currentAction}=await import('./fixtures');const {processHubTasks}=await import('../../lib/task-runner');
 const {grantKey,availabilityKey,defaultAvailability}=await import('../../lib/personal-calendar/service');
 const {previewMailRecovery,executeMailRecovery}=await import('../../lib/hub/mail-recovery');
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
 const owner={email:'sales@aicaseleads.com',userId:'owner',isOwner:true,role:'admin' as const};
 for(const [id,email]of [['owner',owner.email],['interviewer',RECRUITER.email]])await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",id,email,'admin').run();
 await f.store.setSetting(grantKey(RECRUITER.email),{email:RECRUITER.email,calendarId:RECRUITER.email,sealedToken:'synthetic-calendar',revision:0,fingerprint:'synthetic',connectedAt:1});
 await f.store.setSetting(availabilityKey(RECRUITER.email),defaultAvailability);await f.store.stmt("UPDATE hub_tasks SET status='done'").run();
 const input={...DEFAULT_INTERVIEW,templateVersion:1,interviewerEmail:RECRUITER.email},preview=await interviewMessage(f.store,owner,app.id,input);
 await currentAction(f.store,app.id,{action:'interview',...input,previewFingerprint:preview.fingerprint},owner);
 await f.store.stmt('UPDATE hub_members SET active=0 WHERE email=?',RECRUITER.email).run();
 let sends=0;const transport={setDeadline:()=>{},sendMail:async()=>{sends++;return {id:'synthetic-sent',threadId:'synthetic-thread'}},verifyMailSender:async()=>{}};
 await processHubTasks(f.store,f.db,undefined,undefined,3,[],async()=>transport as never);
 const task=await f.store.stmt("SELECT id,status,last_error,run_after,attempts,result_json FROM hub_tasks WHERE id LIKE ?",`gmail:${app.id}:interview:%`).first<{id:string;status:string;last_error:string;run_after:number;attempts:number;result_json:string}>();
 assert.equal(sends,0);assert.equal(task?.status,'failed');assert.equal(task.last_error,'interviewer_not_active');assert.equal(task.run_after,Number.MAX_SAFE_INTEGER);assert.equal(JSON.parse(task.result_json).retryRequiresReview,true);
 await f.store.stmt('UPDATE hub_members SET active=1 WHERE email=?',RECRUITER.email).run();
 await processHubTasks(f.store,f.db,undefined,undefined,3,[],async()=>transport as never);assert.equal(sends,0);
 const held=await f.store.stmt('SELECT attempts,run_after FROM hub_tasks WHERE id=?',task.id).first<{attempts:number;run_after:number}>();assert.equal(held?.attempts,task.attempts);assert.equal(held?.run_after,Number.MAX_SAFE_INTEGER);
 const deps={env:{},resolve:async()=>transport};
 const recovery=await previewMailRecovery(f.store,owner,{from:Date.now()-60000,to:Date.now()+60000},deps);assert.equal(recovery.eligible,1);
 assert.deepEqual(await executeMailRecovery(f.store,owner,{planId:recovery.planId,digest:recovery.digest},deps),{queued:1,alreadyQueued:false});
 await processHubTasks(f.store,f.db,undefined,undefined,3,[],async()=>transport as never);assert.equal(sends,1);
 }finally{f.database.close()}});
