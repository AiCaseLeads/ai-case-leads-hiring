import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHmac} from 'node:crypto';
import {createStore,jobInput,applicationInput,RECRUITER,MANAGER} from './fixtures';
import {saveRecruiterReview,getRecruiterReview} from '../../lib/hub/recruiting-workflow';

test('signed webhook imports canonical provider evidence to one matching interview and replays without side effects',async()=>{
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = {};',shortCircuit:true};return next(specifier,context);}});
 const originalKey=process.env.GOOGLE_TOKEN_KEY,originalFetch=globalThis.fetch;
 process.env.GOOGLE_TOKEN_KEY='ab'.repeat(32);
 const fixture=createStore();
 try{
  const {receiveMeetGeekWebhook,saveMeetGeekSettings}=await import('../../lib/meetgeek/service');
  const {store,database}=fixture,job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),other=await store.acceptApplication(applicationInput(job.id));
  const row=await store.applicationRow(app.id),otherRow=await store.applicationRow(other.id);
  database.prepare("INSERT INTO hub_interviews(id,application_id,provider_id,status,start,end,revision,created_at,updated_at) VALUES(?,?,?,'booked','2025-01-01T12:00:00Z','2025-01-01T12:30:00Z',1,0,0)").run('correct-interview',app.id,'calendar-event');
  database.prepare("INSERT INTO hub_interviews(id,application_id,provider_id,status,start,end,revision,created_at,updated_at) VALUES(?,?,?,'booked','2025-01-01T12:00:00Z','2025-01-01T12:30:00Z',1,0,0)").run('other-interview',other.id,'calendar-event');
  await saveRecruiterReview(store,app.id,{expectedVersion:0,recommendation:'hold',notes:'Recruiter notes',summary:'Human summary must remain',recordingUrl:'',salaryExpectation:'',availability:'',concerns:''},RECRUITER);
  await saveMeetGeekSettings(store,{enabled:true,region:'eu',apiKey:'synthetic-provider-key',webhookSecret:'synthetic-webhook-secret'},MANAGER);
  const meetingId='test-meeting-1234',requests:string[]=[];
  globalThis.fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api-eu.meetgeek.ai');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-provider-key');requests.push(url.pathname);if(url.pathname.endsWith('/summary'))return Response.json({meeting_id:meetingId,summary:'Provider summary'});if(url.pathname.endsWith('/transcript'))return Response.json({meeting_id:meetingId,sentences:[{speaker:'Candidate',timestamp:'00:01',transcript:'Production evidence discussed'}],pagination:{}});assert.equal(url.pathname,'/v1/meetings/'+meetingId);return Response.json({meeting_id:meetingId,title:'Synthetic candidate interview',participant_emails:[row.email],event_id:'calendar-event',timestamp_start_utc:'2025-01-01T12:00:00Z'});};
  const body=JSON.stringify({message:'File analyzed successfully',meeting_id:meetingId});
  const signature=createHmac('sha256','synthetic-webhook-secret').update(body).digest('hex');
  const request=(sig=signature)=>new Request('https://jobs.example.invalid/api/integrations/meetgeek',{method:'POST',headers:{'content-type':'application/json','X-MG-Signature':sig},body});
  const before=await store.applicationRow(app.id),tasksBefore=database.prepare('SELECT COUNT(*) AS n FROM hub_tasks').get()!.n;
  await assert.rejects(receiveMeetGeekWebhook(request('0'.repeat(64)),store),{code:'invalid_meetgeek_signature',status:401});assert.equal(requests.length,0);
  const response=await receiveMeetGeekWebhook(request(),store);assert.equal(response.status,200);assert.equal(await response.text(),'');
  const review=await getRecruiterReview(store,app.id),evidence=await store.setting<{interviewId:string;transcript:string;summary:string} | null>('interview_evidence:'+app.id+':'+meetingId,null);
  assert.equal(review.summary,'Human summary must remain');assert.equal(review.recordingUrl,'/api/hub/meetgeek/meetings/'+meetingId+'/recording');assert.equal(evidence?.interviewId,'correct-interview');assert.match(evidence?.transcript||'',/Production evidence discussed/);assert.equal(evidence?.summary,'Provider summary');
  assert.equal((await store.applicationRow(app.id)).stage,before.stage);assert.equal((await getRecruiterReview(store,other.id)).version,0);assert.equal((await store.applicationRow(other.id)).email,otherRow.email);
  const history=database.prepare('SELECT COUNT(*) AS n FROM hub_history WHERE application_id=?').get(app.id)!.n,apiCalls=requests.length;
  assert.equal((await receiveMeetGeekWebhook(request(),store)).status,200);assert.equal((await getRecruiterReview(store,app.id)).version,review.version);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM hub_history WHERE application_id=?').get(app.id)!.n,history);assert.equal(requests.length,apiCalls);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM hub_tasks').get()!.n,tasksBefore);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.GOOGLE_TOKEN_KEY;else process.env.GOOGLE_TOKEN_KEY=originalKey;hooks.deregister();fixture.database.close();}
});
