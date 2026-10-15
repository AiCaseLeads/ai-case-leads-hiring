import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER} from '../hub/fixtures';
import {sealToken} from '../../lib/google/oauth';
import {processAiMatches,reconcileMatches,matchDetail,matchJobStatus,validateMatchCriteria,matchCoverage,type MatchDeps} from '../../lib/ai/matching';
import {handleAiMatch} from '../../lib/ai/match-http';
const encryptionKey='c'.repeat(64),origin='https://jobs.example.invalid';
const criterion='Build React applications',resume='Built React applications for two years.';
function request(body?:unknown,method=body?'POST':'GET',source=origin){return new Request(`${origin}/api/ai/match`,{method,headers:{origin:source,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function fixture(){
 const f=createStore();
 const job=await f.store.saveJob({...jobInput(),descriptionHtml:'<p>Build React applications and maintain tested production websites.</p>',aiMatchEnabled:true});
 const accepted=await f.store.acceptApplication(applicationInput(job.id));
 await f.store.setSetting('ai_openrouter_config_v1',{enabled:true,sealedKey:await sealToken('sk-or-testcredentialneverreal',encryptionKey)});
 let calls=0;
 const deps:MatchDeps={store:f.store,encryptionKey,fetcher:async(_url,init)=>{
  calls++;const data=JSON.parse(init!.body as string),isCriteria=data.response_format.json_schema.name==='job_requirements';
  assert.equal(data.model,'openai/gpt-5-mini');
  if(!isCriteria)assert.match(data.messages[0].content,/clearly satisfies the COMPLETE criterion/);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(isCriteria?{criteria:[{criterion,quote:criterion}]}:{criteria:[{criterion,status:'evidence_found',explanation:'Résumé reports React work.',citations:[{source:'resume',quote:resume}]}],checks:[]})}}]});
 },readPdf:async(_app,id)=>({status:'ready',text:resume,pages:1,truncated:false,message:'Read',fileId:id,filename:'resume.pdf',cached:false})};
 return {...f,job,id:accepted.id,deps,calls:()=>calls};
}
async function addPdf(f:Awaited<ReturnType<typeof fixture>>,id=f.id){
 const fileId='a'.repeat(64),now=Date.now();
 await f.store.stmt("INSERT INTO hub_files(id,job_id,field_path,application_id,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES(?,?,'_systemfield_resume',?,'resume.pdf','application/pdf',20,?, ?,9999999999999,'test')",fileId,f.job.id,id,fileId,now).run();
 const app=await f.store.getApplication(id);
 await f.store.stmt('UPDATE hub_applications SET answers_json=? WHERE id=?',JSON.stringify([...app.answers,{path:'_systemfield_resume',value:fileId}]),id).run();
}
test('matching uses shared grounded criteria, deterministic coverage, durable archive and no hiring action',async()=>{
 const f=await fixture();await addPdf(f);const before=await f.store.getApplication(f.id);
 await processAiMatches(f.deps);assert.equal(f.calls(),1);await processAiMatches(f.deps);
 const match=await matchDetail(f.store,f.id);assert.equal(match.status,'ready');assert.equal(match.score,100);assert.equal(match.criteria[0].citations[0].quote,resume);
 const after=await f.store.getApplication(f.id);assert.equal(after.stage,before.stage);assert.equal(after.qualification,before.qualification);assert.deepEqual(after.grade,before.grade);
 assert.ok(after.history.some(x=>x.type==='ai_match'));assert.ok((await f.store.tasks()).some(x=>x.kind==='drive'&&x.id.includes('ai-match:')));assert.equal(after.revision,before.revision+1);
 await processAiMatches(f.deps);assert.equal(f.calls(),2);
 f.database.close();
});
test('missing resume and unreadable evidence are unscored; transient extraction retries',async()=>{
 const f=await fixture();await processAiMatches(f.deps);await processAiMatches(f.deps);
 assert.equal((await matchDetail(f.store,f.id)).status,'needs_review');assert.equal((await matchDetail(f.store,f.id)).score,null);assert.equal(f.calls(),1);
 await addPdf(f);await handleAiMatch(request({jobId:f.job.id}),RECRUITER,f.deps);
 f.deps.readPdf=async(_id,fileId)=>({status:'timeout',text:'',pages:0,truncated:false,message:'temporary',fileId,filename:'resume.pdf',cached:false});
 await processAiMatches(f.deps);assert.equal((await matchDetail(f.store,f.id)).status,'failed');assert.equal((await matchDetail(f.store,f.id)).score,null);
 f.database.close();
});
test('job changes invalidate old rankings; SQL sort compares all pages and rejects missing posting',async()=>{
 const f=await fixture();
 for(let i=0;i<35;i++){
  const input=applicationInput(f.job.id);input.submissionKey=crypto.randomUUID();
  input.fieldSubmissions=input.fieldSubmissions.map(a=>a.path==='_systemfield_email'?{...a,value:`test${i}@example.invalid`}:a);
  const a=await f.store.acceptApplication(input);
  await f.store.stmt("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,updated_at) VALUES(?,?,?,'ready',?,?)",a.id,f.job.id,f.job.formVersion,i,Date.now()).run();
 }
 const sorted=await f.store.applications({jobId:f.job.id,sort:'ai_match_desc'});assert.equal(sorted.items.length,30);assert.equal(sorted.items[0].aiMatch?.score,34);assert.equal(sorted.items[29].aiMatch?.score,5);
 await assert.rejects(()=>f.store.applications({sort:'ai_match_desc'}));
 await f.store.saveJob({...f.job,descriptionHtml:'<p>Updated role requiring different experience and work.</p>'},f.job.id,f.job.formVersion);
 const stale=await f.store.applications({jobId:f.job.id,sort:'ai_match_desc'});assert.ok(stale.items.every(a=>a.aiMatch?.score===null));
 f.database.close();
});
test('leases, missing configuration, retry backoff and global budget prevent duplicate or unbounded provider calls',async()=>{
 const f=await fixture();await f.store.setSetting('ai_match_worker_lease',{lease:'other'});await f.store.stmt("UPDATE hub_settings SET updated_at=? WHERE key='ai_match_worker_lease'",Date.now()+100000).run();
 await processAiMatches(f.deps);assert.equal(f.calls(),0);
 await f.store.stmt("DELETE FROM hub_settings WHERE key='ai_match_worker_lease'").run();
 await f.store.stmt("INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES('ai-match-global',?,120)",Math.floor(Date.now()/3600000)).run();await processAiMatches(f.deps);assert.equal(f.calls(),0);
 await f.store.setSetting('ai_openrouter_config_v1',{enabled:false});await processAiMatches(f.deps);assert.equal(f.calls(),0);assert.equal((await matchJobStatus(f.store,f.job.id)).status,'setup_required');
 f.database.close();
});
test('API requires staff, same origin, explicit opt-in and current job version; disabled jobs are untouched',async()=>{
 const f=await fixture(),input={jobId:f.job.id,enabled:true,expectedVersion:f.job.formVersion,consent:true};
 assert.equal((await handleAiMatch(request(input,'PATCH'),null,f.deps)).status,403);
 assert.equal((await handleAiMatch(request(input,'PATCH','https://evil.invalid'),MANAGER,f.deps)).status,403);
 assert.equal((await handleAiMatch(request({...input,consent:false},'PATCH'),MANAGER,f.deps)).status,422);
 assert.equal((await handleAiMatch(request({...input,expectedVersion:99},'PATCH'),MANAGER,f.deps)).status,409);
 assert.equal((await handleAiMatch(request({...input,enabled:false},'PATCH'),RECRUITER,f.deps)).status,200);
 assert.equal((await f.store.getJob(f.job.id)).aiMatchEnabled,false);assert.equal((await f.store.getJob(f.job.id)).formVersion,f.job.formVersion+1);
 await reconcileMatches(f.store);assert.equal(f.database.prepare('SELECT count(*) AS n FROM hub_ai_matches').get()!.n,0);
 f.database.close();
});
test('criteria reject unsupported quotes and protected traits; score is only an exact evidence coverage calculation',()=>{
 assert.throws(()=>validateMatchCriteria([{criterion,quote:'Invented'}],criterion));
 assert.throws(()=>validateMatchCriteria([{criterion:'Young candidate',quote:'Young'}],'Young candidate'));
 assert.throws(()=>validateMatchCriteria([{criterion:'Strong communicator',quote:'young'}],'young'));
 assert.equal(matchCoverage({criteria:[{criterion,status:'evidence_found',explanation:'ok',citations:[]},{criterion:'Other',status:'not_found',explanation:'unknown',citations:[]}],checks:[]}),50);
});
test('explicit retry after missing resume updates history and queues a fresh archive; concurrent workers share lease',async()=>{
 const f=await fixture();await processAiMatches(f.deps);await processAiMatches(f.deps);
 const before=await f.store.getApplication(f.id);assert.equal(before.aiMatch?.status,'needs_review');
 await addPdf(f);await handleAiMatch(request({jobId:f.job.id}),RECRUITER,f.deps);
 await Promise.all([processAiMatches(f.deps),processAiMatches(f.deps)]);
 const after=await f.store.getApplication(f.id);assert.equal(after.aiMatch?.status,'ready');assert.equal(after.revision,before.revision+1);
 assert.equal(after.history.filter(x=>x.type==='ai_match').length,2);
 assert.equal((await f.store.tasks()).filter(x=>x.kind==='drive'&&x.id.includes('ai-match:')).length,2);assert.equal(f.calls(),2);
 f.database.close();
});
test('job disabled during a provider response never receives a ready result',async()=>{
 const f=await fixture();await addPdf(f);await processAiMatches(f.deps);
 const original=f.deps.fetcher!;
 f.deps.fetcher=async(...args)=>{await f.store.stmt('UPDATE hub_jobs SET ai_match_enabled=0 WHERE id=?',f.job.id).run();return original(...args);};
 await processAiMatches(f.deps);
 assert.equal((await matchDetail(f.store,f.id)).status,'disabled');assert.equal((await matchDetail(f.store,f.id)).score,null);
 assert.equal((await f.store.getApplication(f.id)).history.filter(x=>x.type==='ai_match').length,0);
 f.database.close();
});

test('résumé field identity selects the resume when a portfolio PDF is also attached',async()=>{
 const f=await fixture();await addPdf(f);
 await f.store.stmt("INSERT INTO hub_files(id,job_id,field_path,application_id,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES(?,?,'portfolio',?,'portfolio.pdf','application/pdf',20,?,?,9999999999999,'test')",'b'.repeat(64),f.job.id,f.id,'b'.repeat(64),Date.now()).run();
 const original=f.deps.readPdf!;f.deps.readPdf=async(...args)=>{assert.equal(args[1],'a'.repeat(64));return original(...args);};
 await processAiMatches(f.deps);await processAiMatches(f.deps);assert.equal((await matchDetail(f.store,f.id)).score,100);
 f.database.close();
});

test('failed job criteria show an actionable failed candidate status rather than an endless pending result',async()=>{
 const f=await fixture();f.deps.fetcher=async()=>Response.json({error:'unavailable'},{status:503});
 await processAiMatches(f.deps);
 const detail=await matchDetail(f.store,f.id);assert.equal(detail.status,'failed');assert.equal(detail.score,null);assert.equal(detail.error,'ai_provider_unavailable');
 const list=await f.store.applications({jobId:f.job.id});assert.equal(list.items[0].aiMatch?.status,'failed');
 f.database.close();
});
