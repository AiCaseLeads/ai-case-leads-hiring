import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER,currentAction,approveScheduling} from './fixtures';
import {DEFAULT_INTERVIEW,interviewMessage} from '../../lib/hub/interview-template';
import {previewMailRecovery} from '../../lib/hub/mail-recovery';
import {candidateMail,emptyJobTeam,teamKey} from '../../lib/job-team/service';

const owner={...MANAGER,email:'sales@aicaseleads.com'};
type Envelope={sender:string;to:string[];cc:string[];replyTo:string[]};
async function queuedFixture(){
 const f=createStore(),job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
 await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",RECRUITER.userId,RECRUITER.email,'recruiter').run();
 await f.store.setSetting(teamKey(job.id),{...emptyJobTeam,members:[RECRUITER.email],replyTo:RECRUITER.email});
 await approveScheduling(f.store);f.database.prepare("UPDATE hub_tasks SET status='done'").run();
 const input={...DEFAULT_INTERVIEW,templateVersion:1},approved=await interviewMessage(f.store,owner,app.id,input);
 await currentAction(f.store,app.id,{action:'interview',...input,previewFingerprint:approved.fingerprint},owner);
 const task=(await f.store.tasks()).find(item=>item.id.includes(':interview:'))!;
 return {...f,app:await f.store.applicationRow(app.id),task,approved};
}
function ownerEnvironment(t:{after:(callback:()=>void)=>void}){
 const previous=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner.email;t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous;});
}
test('recovery refuses an approved invitation whose effective sender changed instead of offering a doomed retry',async(t)=>{
 ownerEnvironment(t);const f=await queuedFixture();try{
  f.database.prepare("UPDATE hub_tasks SET status='failed' WHERE id=?").run(f.task.id);f.database.prepare("UPDATE hub_communications SET status='failed' WHERE task_id=?").run(f.task.id);
  let checks=0;
  const valid=await previewMailRecovery(f.store,owner,{from:Date.now()-60000,to:Date.now()+60000},{env:{ADMIN_EMAILS:owner.email},resolve:async(account)=>({verifyMailSender:async(sender,required)=>{checks++;assert.equal(account,owner.email);assert.equal(sender,owner.email);assert.equal(required,owner.email);}})});
  assert.equal(valid.eligible,1);assert.equal(checks,1);
  // Removing the owner designation changes legacy fallback routing, while the
  // immutable approval continues to describe the sender the user reviewed.
  process.env.ADMIN_EMAILS='';
  const rerouted=await candidateMail(f.store,f.task.payload as never,[],{applicationId:f.app.id,mailMode:'recruiter',actor:f.task.payload.actor,interview:true});
  assert.equal(rerouted.sender,RECRUITER.email);
  const changed=await previewMailRecovery(f.store,owner,{from:Date.now()-60000,to:Date.now()+60000},{env:{ADMIN_EMAILS:''},resolve:async()=>{assert.fail('changed routing must be excluded before provider verification');}});
  assert.equal(changed.eligible,0);assert.equal(changed.planId,null);assert.ok(changed.skipped.some(item=>item.reason==='Interview reply contact changed after approval; review before sending a replacement'));
  assert.equal(f.database.prepare('SELECT status FROM hub_tasks WHERE id=?').get(f.task.id)!.status,'failed');
 }finally{f.database.close();}
});
test('queued and failed Activity retain the approved owner envelope rather than displaying unsent current routing',async(t)=>{
 ownerEnvironment(t);const f=await queuedFixture();try{
  process.env.ADMIN_EMAILS='';
  for(const status of ['queued','failed']){
   f.database.prepare('UPDATE hub_communications SET status=? WHERE task_id=?').run(status,f.task.id);
   const message=(await f.store.getApplication(f.app.id)).communications.find(item=>item.purpose==='Interview invitation') as unknown as Envelope;
   assert.equal(message.sender,owner.email);assert.deepEqual(message.to,[f.app.email]);assert.deepEqual(message.cc,[owner.email]);assert.deepEqual(message.replyTo,[owner.email]);
   assert.ok(!JSON.stringify(message).includes(RECRUITER.email));
  }
 }finally{f.database.close();}
});
test('Activity prefers the actual attempted delivery envelope over the earlier approval and supports legacy unapproved tasks',async(t)=>{
 ownerEnvironment(t);const f=await queuedFixture();try{
  const actual={sender:'attempted@example.invalid',to:[f.app.email],cc:['observer@example.invalid'],replyTo:['reply@example.invalid']};
  await f.store.stmt('UPDATE hub_tasks SET payload_json=? WHERE id=?',JSON.stringify({...f.task.payload,deliveryEnvelope:actual}),f.task.id).run();
  const recorded=(await f.store.getApplication(f.app.id)).communications.find(item=>item.purpose==='Interview invitation') as unknown as Envelope;
  assert.equal(recorded.sender,actual.sender);assert.deepEqual(recorded.to,actual.to);assert.deepEqual(recorded.cc,actual.cc);assert.deepEqual(recorded.replyTo,actual.replyTo);
  const {approvedEnvelope:_approved,...legacy}=f.task.payload;void _approved;
  await f.store.stmt('UPDATE hub_tasks SET payload_json=? WHERE id=?',JSON.stringify(legacy),f.task.id).run();
  const reconstructed=(await f.store.getApplication(f.app.id)).communications.find(item=>item.purpose==='Interview invitation') as unknown as Envelope;
  assert.equal(reconstructed.sender,owner.email);assert.deepEqual(reconstructed.to,[f.app.email]);assert.deepEqual(reconstructed.cc,[owner.email]);
 }finally{f.database.close();}
});
