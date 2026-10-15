import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from '../hub/fixtures';
import {recoverLegacyMatches,MATCH_RECOVERY_KEY} from '../../lib/ai/match-recovery';

test('source-span deployment recovery is bounded, one-time and preserves results, errors and budget',async()=>{
 const f=createStore();try {
  const job=await f.store.saveJob({...jobInput(),aiMatchEnabled:true});const now=Date.now();
  const add=async(status:string,error:string|null,lease:number|null=null,version=job.formVersion)=>{
   const app=await f.store.acceptApplication(applicationInput(job.id));
   await f.store.stmt('INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,error,attempts,run_after,lease_until,updated_at) VALUES(?,?,?,?,?,?,5,?,?,?)',app.id,job.id,version,status,status==='ready'?75:null,error,now+999999,lease,now-1000).run();return app.id;
  };
  const failed=[];for(let i=0;i<101;i++)failed.push(await add('failed','ai_response_quote_unverified'));
  const orphan=await add('running',null,now-1),ready=await add('ready',null),manual=await add('needs_review',null),other=await add('failed','pdf_temporarily_unavailable'),oldVersion=await add('failed','ai_request_timeout',null,0),live=await add('running',null,now+180000);
  await f.store.stmt("INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES('ai-match-global',1,120)").run();
  assert.equal(await recoverLegacyMatches(f.store,now),100);
  assert.equal((await f.store.setting<{complete:boolean}>(MATCH_RECOVERY_KEY,{complete:true})).complete,false);
  assert.equal(await recoverLegacyMatches(f.store,now+1),2);
  assert.equal(await recoverLegacyMatches(f.store,now+2),0);
  for(const id of [...failed,orphan]){const row=await f.store.stmt('SELECT status,attempts,run_after,error FROM hub_ai_matches WHERE application_id=?',id).first<{status:string;attempts:number;run_after:number;error:string|null}>();assert.equal(row?.status,'pending');assert.equal(row.attempts,0);assert.equal(row.run_after,0);assert.equal(row.error,null);}
  for(const [id,status]of [[ready,'ready'],[manual,'needs_review'],[other,'failed'],[oldVersion,'failed'],[live,'running']])assert.equal((await f.store.stmt('SELECT status FROM hub_ai_matches WHERE application_id=?',id).first<{status:string}>())?.status,status);
  assert.equal((await f.store.setting<{complete:boolean}>(MATCH_RECOVERY_KEY,{complete:true})).complete,false);
  assert.equal(await recoverLegacyMatches(f.store,now+180001),1);
  assert.equal((await f.store.stmt('SELECT status,attempts FROM hub_ai_matches WHERE application_id=?',live).first<{status:string;attempts:number}>())?.attempts,0);
  assert.equal((await f.store.setting<{complete:boolean}>(MATCH_RECOVERY_KEY,{complete:false})).complete,true);
  await f.store.stmt("UPDATE hub_ai_matches SET status='failed',attempts=5,error='ai_request_timeout' WHERE application_id=?",failed[0]).run();
  assert.equal(await recoverLegacyMatches(f.store,now+1000000),0);
  assert.equal((await f.store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global'").first<{attempts:number}>())?.attempts,120);
  const audit=await f.store.stmt("SELECT after_json FROM hub_audit WHERE type='ai_queue_recovery' ORDER BY created_at LIMIT 1").first<{after_json:string}>();
  assert.ok(JSON.parse(audit!.after_json).errorCounts.ai_response_quote_unverified>0);
  assert.equal((await f.store.stmt("SELECT COUNT(*) AS n FROM hub_audit WHERE type='ai_queue_recovery'").first<{n:number}>())?.n,3);
 }finally{f.database.close();}
});
