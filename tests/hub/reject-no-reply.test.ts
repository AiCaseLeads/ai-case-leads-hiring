import type {MailInput} from "../../lib/google/gmail";
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,RECRUITER} from './fixtures';
import {handleHubRequest} from '../../lib/hub/http';
import {processHubTasks} from '../../lib/task-runner';
import {AUTOMATIC_SENDER,AUTOMATIC_REPLY_TO} from '../../lib/email/contracts';
import {candidateTaskMailMode} from '../../lib/google/mail-setup';
import type {HubMember} from '../../lib/hub/auth';
const origin='https://jobs.example.invalid';
const request=(id:string,revision:number,source=origin)=>new Request(`${origin}/api/hub/applications/${id}/action`,{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify({action:'reject',reason:'Not selected after recruiter review.',expectedRevision:revision})});
async function fixture(){const f=createStore(),job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));f.database.prepare("UPDATE hub_tasks SET status='done',result_json=?").run(JSON.stringify({archivedRevision:999,archiveFormat:'pdf-v2'}));return {...f,app};}
test('rejection is atomic, revision guarded, and repeated clicks never queue duplicate emails',async()=>{
 const f=await fixture();try{
  const id=f.app.id,revision=(await f.store.applicationRow(id)).revision,path=['applications',id,'action'];
  assert.equal((await handleHubRequest(request(id,revision),path,null as unknown as HubMember,f.store)).status,403);
  assert.equal((await handleHubRequest(request(id,revision,'https://foreign.invalid'),path,RECRUITER,f.store)).status,403);
  assert.equal((await handleHubRequest(request(id,revision+1),path,RECRUITER,f.store)).status,409);
  assert.equal((await f.store.applicationRow(id)).stage,'Application Review');
  const responses=await Promise.all([1,2].map(()=>handleHubRequest(request(id,revision),path,RECRUITER,f.store)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const row=await f.store.applicationRow(id);assert.equal(row.stage,'Rejected');assert.equal(row.revision,revision+1);
  assert.equal((await handleHubRequest(request(id,row.revision),path,RECRUITER,f.store)).status,200);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE id LIKE ?").get(`gmail:${id}:rejection:%`)!.n,1);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM hub_communications WHERE task_id LIKE ?").get(`gmail:${id}:rejection:%`)!.n,1);
 }finally{f.database.close();}
});
test('manual rejection uses no-reply SendGrid, holds setup failures and retries without altering the decision',async()=>{
 const f=await fixture();try{
  const id=f.app.id;await f.store.action(id,{action:'reject',reason:'Not selected after recruiter review.',expectedRevision:(await f.store.applicationRow(id)).revision},RECRUITER);
  const taskId=(await f.store.tasks()).find(t=>t.id.startsWith(`gmail:${id}:rejection:`))!.id;
  assert.equal(candidateTaskMailMode(taskId,id,{mailMode:'recruiter',actor:RECRUITER.email}),undefined,'Legacy queued rejection also uses no-reply');
  let sends=0;const sender={fingerprint:'synthetic',verify:async()=>{},reconcileMail:async()=>null,sendMail:async(mail:MailInput)=>{sends++;assert.equal(mail.sender,AUTOMATIC_SENDER);assert.deepEqual(mail.replyTo,[AUTOMATIC_REPLY_TO]);assert.equal(mail.candidateAccount,undefined);assert.doesNotMatch(JSON.stringify(mail),/recruiter@example.invalid/);return{id:'synthetic-send',accepted:true};}};
  await processHubTasks(f.store,f.db,undefined,undefined,5,[],async()=>null,async()=>{throw{code:'transactional_mail_key_required',uncertain:false};});
  const failed=(await f.store.tasks()).find(t=>t.id===taskId)!;assert.equal(failed.status,'failed');assert.equal(failed.runAfter,Number.MAX_SAFE_INTEGER);assert.equal((await f.store.applicationRow(id)).stage,'Rejected');assert.equal(sends,0);
  await f.store.retryTask(taskId);
  await processHubTasks(f.store,f.db,undefined,undefined,5,[],async()=>null,async()=>sender);
  await processHubTasks(f.store,f.db,undefined,undefined,5,[],async()=>null,async()=>sender);
  assert.equal(sends,1);assert.equal((await f.store.tasks()).find(t=>t.id===taskId)!.status,'done');
 }finally{f.database.close();}
});
test('active review filter matches all-page export/navigation while explicit history stages remain available',async()=>{
 const f=await fixture();try{
  const first=await f.store.applicationRow(f.app.id), ids=[first.id];
  for(const stage of ['Rejected','Withdrawn','Hired','Screening']){const {id}=await f.store.acceptApplication(applicationInput(first.job_id));f.database.prepare('UPDATE hub_applications SET stage=? WHERE id=?').run(stage,id);ids.push(id);}
  const filters={jobId:first.job_id,active:true,sort:'newest' as const};const list=await f.store.applications(filters);assert.equal(list.total,2);assert.deepEqual(new Set(list.items.map(x=>x.id)),new Set([ids[0],ids[4]]));
  assert.deepEqual(await f.store.exportIds(filters),list.items.map(x=>x.id));assert.equal((await f.store.applicationNavigation(list.items[0].id,filters)).nextId,list.items[1].id);
  assert.deepEqual((await f.store.applications({...filters,stage:'Rejected'})).items.map(x=>x.id),[ids[1]]);
  const response=await handleHubRequest(new Request(`${origin}/api/hub/applications?active=true`),['applications'],RECRUITER,f.store);assert.equal(response.status,200);assert.equal((await response.json() as {data:{total:number}}).data.total,2);
  const all=await handleHubRequest(new Request(`${origin}/api/hub/applications?active=false`),['applications'],RECRUITER,f.store);assert.equal((await all.json() as {data:{total:number}}).data.total,5);
  assert.equal((await handleHubRequest(new Request(`${origin}/api/hub/applications?active=invalid`),['applications'],RECRUITER,f.store)).status,422);
 }finally{f.database.close();}
});
