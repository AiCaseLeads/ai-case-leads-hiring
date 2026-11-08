import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {AGENT_SCOPES,issueAccess} from '../../lib/agent-api/access';
import {handleAgentRead} from '../../lib/agent-api/read';
import {AGENT_READ_LIMITS,agentReadErrorResponse} from '../../lib/agent-api/errors';
import {takeAgentReadBudget} from '../../lib/agent-api/limits';
import {DeadlineError} from '../../lib/hiring/deadline';
import type {HubStore} from '../../lib/hub/store';

type ErrorBody={error:{code:string;message:string;limit?:Record<string,number>;retryAfterSeconds?:number}};
const errorBody=async(response:Response)=>await response.json() as ErrorBody;
const request=(token:string,query:string,method='GET')=>new Request('https://jobs.example.invalid/api/agent-read?'+query,{method,headers:{authorization:'Bearer '+token}});
test('new read tools use only applicants:read and cannot mutate applicants or token scopes',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  const allowed=await issueAccess(store,'read',['applicants:read'],'owner'),denied=await issueAccess(store,'jobs',['jobs:read','jobs:draft','jobs:publish'],'owner');
  const taskCount=database.prepare('SELECT count(*) n FROM hub_tasks').get()?.n;
  const before=database.prepare('SELECT * FROM hub_applications WHERE id=?').get(app.id),accessBefore=await store.setting('agent_access_'+allowed.id,null);
  for(const query of ['action=export_applicants&jobId='+job.id,'action=search_applicants&q=synthetic']){
   assert.equal((await handleAgentRead(request('invalid',query),store)).status,401);
   assert.equal((await handleAgentRead(request(denied.token,query),store)).status,403);
   assert.equal((await handleAgentRead(request(allowed.token,query),store)).status,200);
   assert.equal((await handleAgentRead(request(allowed.token,query,'POST'),store)).status,405);
  }
  assert.deepEqual(database.prepare('SELECT * FROM hub_applications WHERE id=?').get(app.id),before);
  assert.deepEqual(await store.setting('agent_access_'+allowed.id,null),accessBefore);
  assert.deepEqual(AGENT_SCOPES,['jobs:read','jobs:draft','jobs:publish','applicants:read','files:read']);
  assert.equal(database.prepare('SELECT count(*) n FROM hub_file_text').get()?.n,0);
  assert.equal(database.prepare('SELECT count(*) n FROM hub_tasks').get()?.n,taskCount);
 }finally{database.close()}
});
test('read budget is atomic, token-local, resets each minute and returns exact retry metadata',async()=>{
 const {store,database}=createStore();try{
  const now=1_800_000_012_000,access=await issueAccess(store,'read',['applicants:read','jobs:read'],'owner');
  const results=await Promise.allSettled(Array.from({length:61},()=>takeAgentReadBudget(store,access.id,now)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,60);
  const exhausted=results.find(result=>result.status==='rejected') as PromiseRejectedResult;
  assert.equal(exhausted.reason.code,'agent_read_rate_limited');
  const response=await handleAgentRead(request(access.token,'action=search_applicants&q=synthetic'),store,undefined,{now:()=>now});
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'48');
  assert.deepEqual((await errorBody(response)).error,{code:'agent_read_rate_limited',message:'This connection reached its limit of 60 read requests per 60 seconds. Retry after 48 seconds.',limit:{requests:60,windowSeconds:60},retryAfterSeconds:48});
  assert.equal((await handleAgentRead(request(access.token,'action=list_jobs'),store,undefined,{now:()=>now})).status,429);
  const other=await issueAccess(store,'other',['applicants:read'],'owner');
  assert.equal((await handleAgentRead(request(other.token,'action=search_applicants&q=synthetic'),store,undefined,{now:()=>now})).status,200);
  assert.equal((await handleAgentRead(request(access.token,'action=list_jobs'),store,undefined,{now:()=>now+48000})).status,200);
  assert.equal((await handleAgentRead(request(access.token,'action=list_jobs'),store,undefined,{now:()=>now+600000})).status,200);
 }finally{database.close()}
});
test('read deadlines return actionable timeout limits and no internal details',async()=>{
 const stalled={setting:async()=>new Promise(()=>{})} as unknown as HubStore;
 const response=await handleAgentRead(request('hiring_'+crypto.randomUUID()+'_'+'a'.repeat(64),'action=search_applicants&q=offline'),stalled,undefined,{timeoutMs:5});
 assert.equal(response.status,504);assert.equal(response.headers.get('Retry-After'),'5');
 const body=await errorBody(response);assert.equal(body.error.code,'request_timeout');assert.deepEqual(body.error.limit,{timeoutMs:5});assert.equal(body.error.retryAfterSeconds,5);
 const storage=agentReadErrorResponse(new DeadlineError('storage_timeout'));
 assert.equal(storage.status,504);assert.deepEqual((await errorBody(storage)).error.limit,{timeoutMs:10000});assert.equal(storage.headers.get('Retry-After'),'5');
 const generic=await agentReadErrorResponse(new Error('private provider token must not escape')).text();assert.ok(!generic.includes('private provider'));
 assert.equal(AGENT_READ_LIMITS.timeoutMs,20000);
});

test('original-file timeouts retain concurrency permits and cancel late object bodies',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'file',['applicants:read','files:read'],'owner');
  const fileId='d'.repeat(64),bytes=new Uint8Array([1,2,3]);
  database.prepare('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(fileId,job.id,'_systemfield_resume','resume.pdf','application/pdf',3,'private/late',1,app.id,Date.now()+1000,'a'.repeat(64));
  const query='action=file_content&applicationId='+app.id+'&fileId='+fileId;
  type ObjectResult={size:number;customMetadata:{fileId:string};body:ReadableStream<Uint8Array>};
  const releases:((value:ObjectResult)=>void)[]=[];let cancelled=0;
  const bucket={get:()=>new Promise<ObjectResult>(resolve=>releases.push(resolve))} as unknown as Pick<R2Bucket,'get'>;
  const responses=await Promise.all(Array.from({length:2},()=>handleAgentRead(request(access.token,query),store,bucket,{storageTimeoutMs:2})));
  assert.ok(responses.every(response=>response.status===504));
  const limited=await handleAgentRead(request(access.token,query),store,bucket);
  assert.equal(limited.status,429);assert.deepEqual((await errorBody(limited)).error.limit,{concurrentFileReads:2});assert.equal(limited.headers.get('Retry-After'),'1');
  for(const resolve of releases)resolve({size:3,customMetadata:{fileId},body:new ReadableStream({cancel(){cancelled++;}})});
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(cancelled,2);
  const available={get:async()=>({size:3,customMetadata:{fileId},body:new Response(bytes).body!})} as unknown as Pick<R2Bucket,'get'>;
  assert.equal((await handleAgentRead(request(access.token,query),store,available)).status,200);
 }finally{database.close()}
});
test('a stalled original-file body is cancelled when its storage deadline expires',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'file',['applicants:read','files:read'],'owner'),fileId='c'.repeat(64);
  database.prepare('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(fileId,job.id,'_systemfield_resume','resume.pdf','application/pdf',3,'private/stalled',1,app.id,Date.now()+1000,'a'.repeat(64));
  let cancelled=0;
  const bucket={get:async()=>({size:3,customMetadata:{fileId},body:new ReadableStream({cancel(){cancelled++;}})})} as unknown as Pick<R2Bucket,'get'>;
  const response=await handleAgentRead(request(access.token,'action=file_content&applicationId='+app.id+'&fileId='+fileId),store,bucket,{storageTimeoutMs:2});
  assert.equal(response.status,504);assert.equal((await errorBody(response)).error.code,'storage_timeout');
  await new Promise(resolve=>setTimeout(resolve,2));assert.equal(cancelled,1);
 }finally{database.close()}
});
