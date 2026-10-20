import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,RECRUITER,MANAGER,currentAction,approveScheduling} from './fixtures';
import {teamKey} from '../../lib/job-team/service';
import {processHubTasks} from '../../lib/task-runner';
import type {GoogleWorkspace} from '../../lib/google/workspace';
import type {MailInput} from '../../lib/google/gmail';
test('interview worker sends and records requester CC/reply envelope once',async()=>{
 const f=createStore();try{
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
 f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,'recruiter',1,0,0)").run(RECRUITER.userId,RECRUITER.email);
 await f.store.setSetting(teamKey(job.id),{members:[RECRUITER.email],replyTo:RECRUITER.email});
 await approveScheduling(f.store);f.database.prepare("UPDATE hub_tasks SET status='done'").run();
 const owner={...MANAGER,email:'sales@aicaseleads.com'};
 await currentAction(f.store,app.id,{action:'interview'},owner);
 let sends=0;const transport={setDeadline:()=>{},sendMail:async(mail:MailInput)=>{sends++;assert.equal(mail.sender,RECRUITER.email);assert.deepEqual(mail.cc,[owner.email]);assert.deepEqual(mail.replyTo,[RECRUITER.email,owner.email]);return {id:'sent-interview',threadId:'thread-interview'};}} as unknown as GoogleWorkspace;
 await processHubTasks(f.store,f.db,undefined,undefined,3,[owner.email],async()=>transport);
 assert.equal(sends,1);
 const row=f.database.prepare("SELECT payload_json,status FROM hub_tasks WHERE id LIKE ?").get(`gmail:${app.id}:interview:%`)!;assert.equal(row.status,'done');
 const payload=JSON.parse(String(row.payload_json));assert.deepEqual(payload.deliveryEnvelope.cc,[owner.email]);assert.equal(payload.deliveryAccount,RECRUITER.email);
 const detail=await f.store.getApplication(app.id);const communication=detail.communications.find(item=>item.purpose==='Interview invitation') as unknown as {cc:string[];replyTo:string[];direction:string};
 assert.ok(communication);assert.deepEqual(communication.cc,[owner.email]);assert.equal(communication.direction,'outgoing');
 await processHubTasks(f.store,f.db,undefined,undefined,3,[owner.email],async()=>transport);assert.equal(sends,1);
 }finally{f.database.close();}
});
