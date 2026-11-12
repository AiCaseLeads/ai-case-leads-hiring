import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {issueAccess,validateAccessScopes} from '../../lib/agent-api/access';
import {requestAgentInterview} from '../../lib/agent-api/interview';
import {grantKey,availabilityKey,defaultAvailability} from '../../lib/personal-calendar/service';
import {mailGrantKey} from '../../lib/personal-mail/service';
import {configurationFingerprint} from '../../lib/google/config-state';
import {sealToken} from '../../lib/google/oauth';
const owner='owner@example.com';
const env={GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_TOKEN_KEY:'b'.repeat(64),GOOGLE_CLIENT_REVISION:0,ADMIN_EMAILS:owner};
const req=(token:string)=>new Request('https://jobs.example.invalid/api/agent-interviews',{method:'POST',headers:{authorization:'Bearer '+token}});
test('interview request enforces scope, duplicate and connected calendar/mail checks',async(t)=>{
 const previous=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner;t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous});
 const f=createStore();try{
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
 const read=await issueAccess(f.store,'read',['applicants:read'],owner),write=await issueAccess(f.store,'write',['applicants:read','applicants:interview'],owner);
 const input={applicationId:app.id,expectedRevision:(await f.store.applicationRow(app.id)).revision,interviewerEmail:owner,confirm:true};
 await assert.rejects(requestAgentInterview(f.store,req(read.token),input,env),{code:'agent_scope_required'});
 await assert.rejects(requestAgentInterview(f.store,req(write.token),{...input,confirm:false},env),{code:'invalid_interview_request'});
 await assert.rejects(requestAgentInterview(f.store,req(write.token),{...input,expectedRevision:input.expectedRevision+1},env),{code:'record_changed'});
 await assert.rejects(requestAgentInterview(f.store,req(write.token),input,env),{code:'interview_email_setup_required'});
 f.database.prepare("INSERT INTO hub_interviews(id,application_id,status,revision,created_at,updated_at) VALUES(?,?,'invited',1,0,0)").run('interview-1',app.id);
 assert.deepEqual(await requestAgentInterview(f.store,req(write.token),input,env),{applicationId:app.id,alreadyInvited:true,email:'unchanged'});
 assert.throws(()=>validateAccessScopes(['applicants:interview']),{code:'invalid_access'});
 }finally{f.database.close()}
});
test('interview uses connected staff mailbox, records agent and prevents duplicate',async(t)=>{
 const previous=process.env.ADMIN_EMAILS,original=globalThis.fetch;process.env.ADMIN_EMAILS=owner;t.after(()=>{globalThis.fetch=original;if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous});
 const f=createStore();try{
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id)),fingerprint=await configurationFingerprint(env);
 await f.store.setSetting(grantKey(owner),{email:owner,calendarId:owner,sealedToken:'calendar-separate',revision:0,fingerprint,connectedAt:1});await f.store.setSetting(availabilityKey(owner),defaultAvailability);
 await f.store.setSetting(mailGrantKey(owner),{email:owner,sealedToken:await sealToken('synthetic-refresh',env.GOOGLE_TOKEN_KEY),revision:0,fingerprint,connectedAt:1});
 globalThis.fetch=async(url)=>{const u=new URL(String(url));if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600});if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:owner,historyId:'1'});if(u.pathname.endsWith('/messages/send'))return Response.json({id:'sent-id',threadId:'thread-id'});if(u.pathname.endsWith('/messages'))return Response.json({messages:[]});if(u.pathname.includes('/threads/'))return Response.json({messages:[]});if(u.pathname.endsWith('/history'))return Response.json({historyId:'1',history:[]});throw Error('Unexpected fixture call')};
 // An unrelated open assessment link must not block an interview.
 f.database.prepare("INSERT INTO hub_links(token_hash,application_id,kind,expires_at,payload_json) VALUES(?,?,'assessment',?,?)").run('assessment-hash',app.id,Date.now()+86400000,'{}');
 const access=await issueAccess(f.store,'writer',['applicants:read','applicants:interview'],owner),input={applicationId:app.id,expectedRevision:(await f.store.applicationRow(app.id)).revision,interviewerEmail:owner,confirm:true};
 const result=await requestAgentInterview(f.store,req(access.token),input,env);assert.equal(result.alreadyInvited,false);assert.equal(result.delivery?.status,'sent');
 const audit=f.database.prepare("SELECT actor,after_json FROM hub_audit WHERE type='agent_interview_invitation'").get();assert.equal(audit?.actor,'agent:'+access.id);assert.equal(JSON.parse(String(audit?.after_json)).sender,owner);
 assert.equal((await requestAgentInterview(f.store,req(access.token),input,env)).alreadyInvited,true);assert.equal(f.database.prepare("SELECT count(*) n FROM hub_interviews WHERE application_id=?").get(app.id)?.n,1);
 }finally{f.database.close()}
});
test('revoking access before commit prevents interview and email',async(t)=>{
 const previous=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner;t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous});
 const f=createStore();try{
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id)),fingerprint=await configurationFingerprint(env);
 await f.store.setSetting(grantKey(owner),{email:owner,calendarId:owner,sealedToken:'calendar-separate',revision:0,fingerprint,connectedAt:1});await f.store.setSetting(availabilityKey(owner),defaultAvailability);
 await f.store.setSetting(mailGrantKey(owner),{email:owner,sealedToken:await sealToken('synthetic-refresh',env.GOOGLE_TOKEN_KEY),revision:0,fingerprint,connectedAt:1});
 const access=await issueAccess(f.store,'writer',['applicants:read','applicants:interview'],owner),record=await f.store.setting<Record<string,unknown>>('agent_access_'+access.id,{}),batch=f.store.db.batch.bind(f.store.db);
 f.store.db.batch=async statements=>{f.database.prepare('UPDATE hub_settings SET value=? WHERE key=?').run(JSON.stringify({...record,revoked:true}),'agent_access_'+access.id);return batch(statements)};
 await assert.rejects(requestAgentInterview(f.store,req(access.token),{applicationId:app.id,expectedRevision:(await f.store.applicationRow(app.id)).revision,interviewerEmail:owner,confirm:true},env),{code:'agent_access_changed'});
 assert.equal(f.database.prepare('SELECT count(*) n FROM hub_interviews WHERE application_id=?').get(app.id)?.n,0);
 assert.equal(f.database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE ?").get(`gmail:${app.id}:interview:%`)?.n,0);
 }finally{f.database.close()}
});
