import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {issueAccess,validateAccessScopes} from '../../lib/agent-api/access';
import {rejectApplicant} from '../../lib/agent-api/reject';
const req=(token:string)=>new Request('https://jobs.example.invalid/api/agent-applicants',{method:'POST',headers:{authorization:'Bearer '+token}});
test('rejection requires explicit scope, current revision and confirmation; reason stays out of email',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 const read=await issueAccess(store,'read',['applicants:read'],'owner');const write=await issueAccess(store,'write',['applicants:read','applicants:reject'],'owner');
 const input={applicationId:app.id,expectedRevision:(await store.applicationRow(app.id)).revision,reason:'Private reviewer reason',confirm:true};
 await assert.rejects(rejectApplicant(store,req(read.token),input),{code:'agent_scope_required'});
 await assert.rejects(rejectApplicant(store,req(write.token),{...input,confirm:false}),{code:'invalid_rejection'});
 await assert.rejects(rejectApplicant(store,req(write.token),{...input,expectedRevision:input.expectedRevision+1}),{code:'record_changed'});
 const result=await rejectApplicant(store,req(write.token),input);assert.equal(result.email,'queued');assert.equal((await store.applicationRow(app.id)).stage,'Rejected');assert.equal((await store.applicationRow(app.id)).rejection_reason,input.reason);
 const tasks=database.prepare("SELECT payload_json FROM hub_tasks WHERE id LIKE ?").all(`gmail:${app.id}:rejection:%`);assert.equal(tasks.length,1);assert.doesNotMatch(String(tasks[0].payload_json),/Private reviewer reason/);
 const again=await rejectApplicant(store,req(write.token),input);assert.equal(again.alreadyRejected,true);assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE ?").get(`gmail:${app.id}:rejection:%`)?.n,1);
 assert.throws(()=>validateAccessScopes(['applicants:reject']),{code:'invalid_access'});
 }finally{database.close()}
});

test('revoking a connection during rejection prevents the transaction and email',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'writer',['applicants:read','applicants:reject'],'owner');
 const record=await store.setting<Record<string,unknown>>('agent_access_'+access.id,{}),original=store.db.batch.bind(store.db);
 store.db.batch=async statements=>{database.prepare('UPDATE hub_settings SET value=? WHERE key=?').run(JSON.stringify({...record,revoked:true}),'agent_access_'+access.id);return original(statements)};
 await assert.rejects(rejectApplicant(store,req(access.token),{applicationId:app.id,expectedRevision:(await store.applicationRow(app.id)).revision,reason:'Private',confirm:true}),{code:'agent_access_changed'});
 assert.notEqual((await store.applicationRow(app.id)).stage,'Rejected');assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE ?").get(`gmail:${app.id}:rejection:%`)?.n,0);
 }finally{database.close()}
});

test('agent cannot reject applications beyond initial review or with interview history',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'writer',['applicants:read','applicants:reject'],'owner');
 const input={applicationId:app.id,expectedRevision:(await store.applicationRow(app.id)).revision,reason:'Private',confirm:true};
 for(const stage of ['Screening','Offer','Hired','Withdrawn']){database.prepare('UPDATE hub_applications SET stage=? WHERE id=?').run(stage,app.id);await assert.rejects(rejectApplicant(store,req(access.token),input),{code:'application_stage_requires_review'});}
 database.prepare('UPDATE hub_applications SET stage=? WHERE id=?').run('Application Review',app.id);
 database.prepare("INSERT INTO hub_interviews(id,application_id,status,revision,created_at,updated_at) VALUES(?,?,'invited',1,0,0)").run('i-test',app.id);
 await assert.rejects(rejectApplicant(store,req(access.token),input),{code:'application_interview_requires_review'});
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE ?").get(`gmail:${app.id}:rejection:%`)?.n,0);
 }finally{database.close()}
});

test('rejection write limit returns actionable retry metadata without a decision',async()=>{
 const {sha256}=await import('../../lib/hiring/crypto');const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'writer',['applicants:read','applicants:reject'],'owner');
 const now=Date.now(),key=await sha256('agent-reject:'+access.id+':minute:'+(Math.floor(now/60000)%10));database.prepare('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES(?,?,20)').run(key,Math.floor(now/600000));
 await assert.rejects(rejectApplicant(store,req(access.token),{applicationId:app.id,expectedRevision:(await store.applicationRow(app.id)).revision,reason:'Private',confirm:true}),(error:unknown)=>{const e=error as {code?:string;retryAfterSeconds?:number;limit?:{requests?:number}};return e.code==='agent_reject_rate_limited'&&(e.retryAfterSeconds??0)>0&&e.limit?.requests===20});
 assert.notEqual((await store.applicationRow(app.id)).stage,'Rejected');
 }finally{database.close()}
});

test('trashed and missing applications cannot be rejected',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'writer',['applicants:read','applicants:reject'],'owner');
 const input={applicationId:app.id,expectedRevision:(await store.applicationRow(app.id)).revision,reason:'Private',confirm:true};
 await store.setSetting('application_trash:'+app.id,{deletedAt:Date.now()});
 await assert.rejects(rejectApplicant(store,req(access.token),input),{code:'application_unavailable'});
 await assert.rejects(rejectApplicant(store,req(access.token),{...input,applicationId:'app_'+'b'.repeat(64)}));
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE ?").get(`gmail:${app.id}:rejection:%`)?.n,0);
 }finally{database.close()}
});
