import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from '../hub/fixtures';
import {sealToken} from '../../lib/google/oauth';
import {processAiMatches,reconcileMatches,matchDetail,type MatchDeps} from '../../lib/ai/matching';
const encryptionKey='c'.repeat(64),criterion='Build React applications',resume='Built React applications for two years.';
async function fixture(count=6){
 const f=createStore();
 const job=await f.store.saveJob({...jobInput(),aiMatchEnabled:true,descriptionHtml:'<p>Build React applications and maintain tested production websites.</p>'});
 await f.store.setSetting('ai_openrouter_config_v1',{enabled:true,sealedKey:await sealToken('sk-or-testcredentialneverreal',encryptionKey)});
 const ids:string[]=[];
 for(let i=0;i<count;i++){
  const app=await f.store.acceptApplication(applicationInput(job.id)),fileId=i.toString(16).padStart(64,'0');ids.push(app.id);
  await f.store.stmt("INSERT INTO hub_files(id,job_id,field_path,application_id,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES(?,?,'_systemfield_resume',?,'resume.pdf','application/pdf',20,?,?,9999999999999,'test')",fileId,job.id,app.id,fileId,Date.now()).run();
  await f.store.stmt('UPDATE hub_applications SET answers_json=? WHERE id=?',JSON.stringify([{path:'_systemfield_resume',value:fileId}]),app.id).run();
 }
 await reconcileMatches(f.store);
 await f.store.stmt("UPDATE hub_ai_criteria SET status='ready',criteria_json=? WHERE job_id=?",JSON.stringify([criterion]),job.id).run();
 let active=0,maxActive=0,calls=0,reads=0,maxReads=0;
 const deps:MatchDeps={store:f.store,encryptionKey,readPdf:async(_id,fileId)=>{reads++;maxReads=Math.max(maxReads,reads);await new Promise(r=>setTimeout(r,5));reads--;return {status:'ready',text:resume,pages:1,truncated:false,message:'Read',fileId,filename:'resume.pdf',cached:false};},fetcher:async()=>{active++;calls++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,60));active--;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({criteria:[{criterion,status:'evidence_found',explanation:'Résumé reports React work.',citations:[{id:'resume:0'}]}],checks:[]})}}]});}};
 return {...f,job,ids,deps,metrics:()=>({calls,maxActive,maxReads})};
}
test('one queue cycle pipelines three independent provider requests with only one PDF read at once',async()=>{
 const f=await fixture();try{
  await Promise.all([processAiMatches(f.deps),processAiMatches(f.deps)]);
  assert.deepEqual(f.metrics(),{calls:3,maxActive:3,maxReads:1});
  const rows=await f.store.rows<{status:string}>('SELECT status FROM hub_ai_matches');assert.equal(rows.filter(x=>x.status==='ready').length,3);
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,6);assert.equal((await f.store.rows<{status:string}>('SELECT status FROM hub_ai_matches')).filter(x=>x.status==='ready').length,6);
 }finally{f.database.close();}
});

test('missing/unreadable PDF and temporary local parser contention never spend provider capacity',async()=>{
 const f=await fixture(3);try{
  await f.store.stmt('DELETE FROM hub_files WHERE application_id=?',f.ids[0]).run();
  const reader=f.deps.readPdf!;
  f.deps.readPdf=async(...args)=>{if(args[0]===f.ids[1])return {...await reader(...args),status:'password_protected',text:''};throw new (await import('../../lib/hiring/errors')).HiringError('pdf_busy',429,'Busy');};
  await processAiMatches(f.deps);
  assert.equal(f.metrics().calls,0);
  assert.equal((await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first()),null);
  assert.equal((await matchDetail(f.store,f.ids[0])).status,'needs_review');assert.equal((await matchDetail(f.store,f.ids[1])).status,'needs_review');
  const busy=await f.store.stmt('SELECT status,attempts,error,run_after FROM hub_ai_matches WHERE application_id=?',f.ids[2]).first<{status:string;attempts:number;error:string;run_after:number}>();
  assert.equal(busy?.status,'pending');assert.equal(busy.attempts,0);assert.equal(busy.error,'pdf_busy');assert.ok(busy.run_after>Date.now());
 }finally{f.database.close();}
});

test('hourly cap remains atomic across concurrent lanes, pauses honestly, and spending config does not reset used requests',async()=>{
 const {hourlyRateWindow}=await import('../../lib/hiring/rate-window');const {handleAiConfig}=await import('../../lib/ai/http');const {MANAGER,RECRUITER}=await import('../hub/fixtures');
 const f=await fixture(6);try{
  await f.store.stmt("INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES('ai-match-global',?,119)",hourlyRateWindow()).run();
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,1);
  assert.equal((await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first<{attempts:number}>())?.attempts,120);
  const pending=await f.store.stmt("SELECT application_id FROM hub_ai_matches WHERE status='pending' AND error='ai_hourly_capacity' LIMIT 1").first<{application_id:string}>();
  const detail=await matchDetail(f.store,pending!.application_id);assert.equal(detail.progress?.state,'capacity_paused');assert.equal(detail.progress?.hourlyLimit,120);assert.equal(detail.progress?.capacityRemaining,0);assert.ok(detail.progress!.nextRetryAt!>Date.now());
  const req=(limit:number)=>new Request('https://jobs.example.invalid/api/ai/config',{method:'PATCH',headers:{origin:'https://jobs.example.invalid','content-type':'application/json'},body:JSON.stringify({enabled:true,hourlyLimit:limit})});
  assert.equal((await handleAiConfig(req(180),RECRUITER,f.deps)).status,403);
  assert.equal((await handleAiConfig(req(1001),MANAGER,f.deps)).status,422);
  assert.equal((await handleAiConfig(req(180),MANAGER,f.deps)).status,200);
  assert.equal((await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first<{attempts:number}>())?.attempts,120);
  assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE error='ai_hourly_capacity' AND run_after>0").first<{n:number}>())?.n,0);
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,4);
  assert.equal((await matchDetail(f.store,f.ids[0])).progress?.hourlyLimit,180);
 }finally{f.database.close();}
});

test('running rows display live processing and renewable leases prevent takeover beyond the original expiry',async t=>{
 const f=await fixture(3);let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r);let calls=0;
 const original=f.deps.fetcher!;
 f.deps.fetcher=async(...args)=>{calls++;if(calls===3)started();await hold;return original(...args);};
 const began=Date.now();t.mock.timers.enable({apis:['setInterval','Date'],now:began});
 try{
  const first=processAiMatches(f.deps);await ready;
  assert.equal((await matchDetail(f.store,f.ids[0])).status,'running');
  assert.equal((await matchDetail(f.store,f.ids[0])).progress?.state,'running');
  t.mock.timers.tick(181000);
  await processAiMatches(f.deps);assert.equal(calls,3);
  const lease=await f.store.stmt("SELECT updated_at FROM hub_settings WHERE key='ai_match_worker_lease'").first<{updated_at:number}>();assert.ok(lease!.updated_at>Date.now());
  release();await first;assert.equal(calls,3);
 }finally{release();t.mock.timers.reset();f.database.close();}
});

test('current queue excludes Trash, fresh candidates have priority, and expired rows recover without touching older job versions',async()=>{
 const {changeApplicationTrash}=await import('../../lib/hub/application-lifecycle');const {MANAGER}=await import('../hub/fixtures');
 const f=await fixture(6);try{
  await f.store.stmt("UPDATE hub_ai_matches SET status='failed',attempts=1,error='ai_request_timeout',updated_at=? WHERE application_id=?",Date.now()-100000,f.ids[0]).run();
  await f.store.stmt("UPDATE hub_ai_matches SET status='running',attempts=1,lease_until=?,updated_at=? WHERE application_id=?",Date.now()-1,Date.now()-100000,f.ids[1]).run();
  const app=await f.store.getApplication(f.ids[2]);await changeApplicationTrash(f.store,app.id,'trash',app.revision,MANAGER);
  await f.store.stmt("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,attempts,error,updated_at) VALUES(?,?,0,'failed',5,'ai_invalid_response',?)",f.ids[3],f.job.id,Date.now()-100000).run();
  await f.store.setSetting('ai_match_recovery:source_spans_v1',{cutoff:Date.now()-1000000,complete:true,recovered:0});
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,3);
  for(const id of f.ids.slice(3))assert.equal((await matchDetail(f.store,id)).status,'ready');
  assert.equal((await f.store.stmt('SELECT status FROM hub_ai_matches WHERE application_id=? AND form_version=?',f.ids[2],f.job.formVersion).first<{status:string}>())?.status,'pending');
  assert.equal((await f.store.stmt('SELECT status FROM hub_ai_matches WHERE application_id=? AND form_version=0',f.ids[3]).first<{status:string}>())?.status,'failed');
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,5);assert.equal((await matchDetail(f.store,f.ids[0])).status,'ready');assert.equal((await matchDetail(f.store,f.ids[1])).status,'ready');
 }finally{f.database.close();}
});

test('rate limiting honors Retry-After and terminal key/credit failures do not spend five automatic retries',async()=>{
 for(const [status,code]of [[429,'ai_provider_rate_limited'],[401,'ai_provider_unauthorized'],[402,'ai_provider_credit_required']] as const){
  const f=await fixture(1);try{
   f.deps.fetcher=async()=>new Response('private provider body',{status,headers:{'Retry-After':'300'}});
   await processAiMatches(f.deps);const detail=await matchDetail(f.store,f.ids[0]);assert.equal(detail.error,code);assert.equal(detail.score,null);assert.ok(!JSON.stringify(detail).includes('private'));
   if(status===429){assert.equal(detail.progress?.state,'provider_paused');assert.ok(detail.progress!.nextRetryAt!>=Date.now()+290000);}else{assert.equal(detail.progress?.state,'retry_limit');assert.equal(detail.progress?.attempts,5);}
   const before=await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first<{attempts:number}>();await processAiMatches(f.deps);assert.deepEqual(await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first(),before);
  }finally{f.database.close();}
 }
});

test('queue ahead is deterministic for a batch enqueued at the same millisecond and leaks no peer applicant data',async()=>{
 const f=await fixture(6);try{
  await f.store.stmt('UPDATE hub_ai_matches SET updated_at=1').run();const sorted=[...f.ids].sort();
  assert.equal((await matchDetail(f.store,sorted[0])).progress?.readyAhead,0);
  const last=await matchDetail(f.store,sorted[5]);assert.equal(last.progress?.readyAhead,5);assert.ok(!JSON.stringify(last.progress).includes('@'));assert.ok(!JSON.stringify(last.progress).includes('application_id'));
 }finally{f.database.close();}
});

test('unchanged job requirements reuse completed evidence atomically; description/opt-in changes or losing job update never reuse',async()=>{
 const {unchangedJobMatchStatements}=await import('../../lib/ai/reuse');
 const f=await fixture(4);try{
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,3);
  const complete=await f.store.stmt("SELECT application_id FROM hub_ai_matches WHERE status='ready' LIMIT 1").first<{application_id:string}>();
  const testedId=complete!.application_id,before=await f.store.getApplication(testedId),previous=f.job,next={title:previous.title,descriptionHtml:previous.descriptionHtml.replace('<p>','<div>').replace('</p>','</div>'),aiMatchEnabled:true};
  // A failed optimistic write must not copy stale results into a concurrent edit.
  await f.store.db.batch([f.store.stmt('UPDATE hub_jobs SET form_version=form_version+1 WHERE id=? AND form_version=99',previous.id),...unchangedJobMatchStatements(f.store,previous,next)]);
  assert.equal((await f.store.stmt('SELECT COUNT(*) AS n FROM hub_ai_matches WHERE form_version=?',previous.formVersion+1).first<{n:number}>())?.n,0);
  assert.equal(unchangedJobMatchStatements(f.store,previous,{...next,descriptionHtml:'<p>A different experience requirement.</p>'}).length,0);
  assert.equal(unchangedJobMatchStatements(f.store,previous,{...next,aiMatchEnabled:false}).length,0);
  await f.store.db.batch([f.store.stmt('UPDATE hub_jobs SET form_version=form_version+1,description_html=? WHERE id=? AND form_version=?',next.descriptionHtml,previous.id,previous.formVersion),...unchangedJobMatchStatements(f.store,previous,next)]);
  const reused=await matchDetail(f.store,testedId);assert.equal(reused.status,'ready');assert.equal(reused.version,previous.formVersion+1);assert.equal(reused.updatedAt,before.aiMatch?.updatedAt);assert.equal(reused.score,before.aiMatch?.score);assert.equal((await f.store.getApplication(testedId)).history.length,before.history.length);
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,4); // only the previously pending applicant
  const current=await f.store.getJob(previous.id);
  await f.store.saveJob({...current,descriptionHtml:'<p>Build React applications with a newly required full-stack skill.</p>'},current.id,current.formVersion);
  assert.equal((await matchDetail(f.store,testedId)).score,null);
 }finally{f.database.close();}
});

test('1,000 submitted records drain with bounded provider/PDF concurrency, no duplicate charges, and one history per applicant',async t=>{
 const f=await fixture(1000);let active=0,maxActive=0,calls=0;const started=performance.now();
 try{
  const config=await f.store.setting<Record<string,unknown>>('ai_openrouter_config_v1',{});await f.store.setSetting('ai_openrouter_config_v1',{...config,hourlyLimit:1000});
  f.deps.fetcher=async()=>{active++;maxActive=Math.max(maxActive,active);calls++;await new Promise(r=>setTimeout(r,12));active--;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({criteria:[{criterion,status:'evidence_found',explanation:'Résumé reports React work.',citations:[{id:'resume:0'}]}],checks:[]})}}]});};
  let cycles=0,hasMore=true;while(hasMore&&cycles<400){hasMore=(await processAiMatches(f.deps)).hasMore;cycles++;}
  assert.equal(calls,1000);assert.equal(maxActive,3);assert.equal(f.metrics().maxReads,1);assert.equal(cycles,334);
  assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches WHERE status='ready'").first<{n:number}>())?.n,1000);
  assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_history WHERE type='ai_match'").first<{n:number}>())?.n,1000);
  assert.equal((await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first<{attempts:number}>())?.attempts,1000);
  assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_applications WHERE stage<>'Application Review'").first<{n:number}>())?.n,0);
  await processAiMatches(f.deps);assert.equal(calls,1000);
  t.diagnostic(`1,000 real SQLite queue records; ${cycles} cycles; network concurrency ${maxActive}; PDF concurrency1; ${(performance.now()-started).toFixed(0)}ms with isolated 12ms provider responses. Hosted/provider latency is not measured.`);
 }finally{f.database.close();}
});

test('a parser that loses its row or global lease cannot call the provider or charge a request',async()=>{
 for(const stealRow of [true,false]){
  const f=await fixture(1);try{
   const reader=f.deps.readPdf!;
   f.deps.readPdf=async(...args)=>{const result=await reader(...args);
    await f.store.setSetting('ai_match_worker_lease',{lease:'replacement-worker'});await f.store.stmt("UPDATE hub_settings SET updated_at=? WHERE key='ai_match_worker_lease'",Date.now()+180000).run();
    if(stealRow)await f.store.stmt("UPDATE hub_ai_matches SET lease_token='replacement-worker',lease_until=? WHERE application_id=?",Date.now()+180000,f.ids[0]).run();
    return result;
   };
   await processAiMatches(f.deps);assert.equal(f.metrics().calls,0);assert.equal(await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first(),null);
   assert.deepEqual(await f.store.setting('ai_match_worker_lease',null),{lease:'replacement-worker'});
   const row=await f.store.stmt('SELECT status,lease_token,run_after,error FROM hub_ai_matches WHERE application_id=?',f.ids[0]).first<{status:string;lease_token:string|null;run_after:number;error:string|null}>();
   if(stealRow){assert.equal(row?.lease_token,'replacement-worker');assert.equal(row.status,'running');}else{assert.equal(row?.status,'pending');assert.equal(row.error,'ai_lease_recovery');assert.ok(row.run_after<Date.now()+10000);}
  }finally{f.database.close();}
 }
});

test('disabling the AI connection while a PDF is read prevents new provider requests and charging',async()=>{
 const f=await fixture(1);try{
  const reader=f.deps.readPdf!;f.deps.readPdf=async(...args)=>{const result=await reader(...args);await f.store.setSetting('ai_openrouter_config_v1',{enabled:false});return result;};
  await processAiMatches(f.deps);assert.equal(f.metrics().calls,0);assert.equal(await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first(),null);assert.equal((await matchDetail(f.store,f.ids[0])).status,'setup_required');
 }finally{f.database.close();}
});
