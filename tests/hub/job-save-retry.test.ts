import assert from 'node:assert/strict';
import {test} from 'node:test';
import {jobSaveRequest,hubRequest,HubError} from '../../components/hub/api';
import {handleJobSetup} from '../../lib/job-setup/http';
import {createStore,jobInput,MANAGER} from './fixtures';
function payload(){return{action:'save',creationId:crypto.randomUUID(),job:{...jobInput(),status:'draft'},location:{workModel:'remote',country:'Spain',city:''},expectedBinding:null,scorecard:null};}
test('502 retries once with exact original payload even if caller changes its draft',async t=>{
 const input=payload(),bodies:string[]=[];let retries=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{bodies.push(String(init.body));return bodies.length===1?Response.json({error:'Bad Gateway'},{status:502}):Response.json({data:{saved:true}});});
 const result=await jobSaveRequest(input,()=>{retries++;input.job.title='Changed during retry';});
 assert.deepEqual(result,{saved:true});assert.equal(retries,1);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.notEqual(JSON.parse(bodies[1]).job.title,input.job.title);
});
test('accepted save with lost response retries the ledger and creates only one posting',async t=>{
 const {store,database}=createStore();t.after(()=>database.close());let calls=0,retries=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  calls++;const response=await handleJobSetup(new Request('https://jobs.example.invalid/api/job-setup',{...init,headers:{'Content-Type':'application/json',Origin:'https://jobs.example.invalid'}}),MANAGER,store);
  assert.equal(response.status,200);if(calls===1)throw new TypeError('network disconnected');return response;
 });
 const input=payload(),saved=await jobSaveRequest<{id:string}>(input,()=>retries++);
 assert.equal(saved.id,input.creationId);assert.equal(calls,2);assert.equal(retries,1);assert.equal((await store.listJobs()).length,1);assert.equal((await store.getJob(saved.id)).formVersion,1);
});
test('conflicts never retry and transient failures stop after the second attempt',async t=>{
 for(const status of [409,422,503,504]){
  let calls=0,retries=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'Safe test error',code:'test'}},{status});});
  await assert.rejects(()=>jobSaveRequest(payload(),()=>retries++),(e:unknown)=>e instanceof HubError&&e.status===status);
  assert.equal(calls,[503,504].includes(status)?2:1);assert.equal(retries,calls-1);mock.mock.restore();
 }
});
test('other mutations do not retry and gateway errors expose no arbitrary upstream body',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'private upstream content'},{status:502});});
 await assert.rejects(()=>hubRequest('/api/hub/applications/id/action','POST',{action:'email'}),(e:unknown)=>e instanceof HubError&&e.message.includes('502')&&!e.message.includes('private'));
 assert.equal(calls,1);await assert.rejects(()=>jobSaveRequest({action:'request',creationId:crypto.randomUUID()},()=>{}));assert.equal(calls,1);
});

test('HTML and malformed JSON gateway envelopes retain transient HTTP status',async t=>{
 for(const response of [new Response('<h1>Gateway</h1>',{status:502}),Response.json(null,{status:504})]){
  const mock=t.mock.method(globalThis,'fetch',async()=>response.clone());
  await assert.rejects(()=>hubRequest('/api/job-setup'),(e:unknown)=>e instanceof HubError&&e.status===response.status&&e.message.includes(String(response.status)));mock.mock.restore();
 }
});
