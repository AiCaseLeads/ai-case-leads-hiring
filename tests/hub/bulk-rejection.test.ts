import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER} from './fixtures';
import {handleHubRequest} from '../../lib/hub/http';
const req=(path:string,body:unknown,origin='https://jobs.example.invalid')=>new Request('https://jobs.example.invalid/api/hub/'+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('bulk preview spans pages, protects progressed candidates and commits repeat-safe rejection mail',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput());const ids:string[]=[];
 for(let i=0;i<125;i++)ids.push((await store.acceptApplication(applicationInput(job.id))).id);
 for(const [i,stage] of ['Screening','Interview','Offer','Hired','Rejected','Withdrawn'].entries())database.prepare('UPDATE hub_applications SET stage=? WHERE id=?').run(stage,ids[i]);
 database.prepare("INSERT INTO hub_history(id,application_id,type,text,actor,to_stage,created_at) VALUES('previous-screening',?,'stage','Shortlisted','test','Screening',1)").run(ids[6]);
 const plan=await store.previewBulkRejection({jobId:job.id},undefined,'Not selected.',MANAGER);assert.equal(plan.count,118);assert.equal(plan.excluded,7);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE '%:rejection:%'").get()!.n,0);
 await assert.rejects(store.executeBulkRejection(plan.planId,RECRUITER),{code:'bulk_plan_forbidden'});
 // A reviewer advancing a candidate after preview must protect that candidate.
 database.prepare("UPDATE hub_applications SET stage='Screening',revision=revision+1 WHERE id=?").run(ids[7]);
 let result=await store.executeBulkRejection(plan.planId,MANAGER);assert.equal(result.remaining,18);
 result=await store.executeBulkRejection(plan.planId,MANAGER);assert.deepEqual(result,{updated:117,skipped:1,total:118,remaining:0,complete:true});
 assert.deepEqual(await store.executeBulkRejection(plan.planId,MANAGER),result);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE '%:rejection:%'").get()!.n,117);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE '%:rejection:%' AND json_extract(payload_json,'$.mailMode')='automatic'").get()!.n,117);
 }finally{database.close();}
});
test('bulk endpoint requires same-origin staff and explicit preview confirmation',async()=>{
 const {store,database}=createStore();try{
 assert.equal((await handleHubRequest(req('bulk-rejection/preview',{},'https://evil.invalid'),['bulk-rejection','preview'],MANAGER,store)).status,403);
 assert.equal((await handleHubRequest(req('bulk-rejection/execute',{planId:crypto.randomUUID()}),['bulk-rejection','execute'],MANAGER,store)).status,422);
 const job=await store.saveJob(jobInput());await store.acceptApplication(applicationInput(job.id));
 const preview=await handleHubRequest(req('bulk-rejection/preview?jobId='+job.id,{}),['bulk-rejection','preview'],MANAGER,store);assert.equal(preview.status,200);const plan=(await preview.json() as {data:{planId:string}}).data;
 const response=await handleHubRequest(req('bulk-rejection/execute',{planId:plan.planId,confirmed:true}),['bulk-rejection','execute'],MANAGER,store);assert.equal(response.status,200);assert.equal((await response.json() as {data:{updated:number}}).data.updated,1);
 }finally{database.close();}
});
test('simultaneous confirmed requests cannot duplicate decisions or outbox tasks',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput());for(let i=0;i<3;i++)await store.acceptApplication(applicationInput(job.id));
 const plan=await store.previewBulkRejection({jobId:job.id},undefined,'Not selected.',MANAGER);
 const outcomes=await Promise.allSettled([store.executeBulkRejection(plan.planId,MANAGER),store.executeBulkRejection(plan.planId,MANAGER)]);
 assert.ok(outcomes.some(result=>result.status==='fulfilled'));
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE '%:rejection:%'").get()!.n,3);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_history WHERE text='Not selected.'").get()!.n,3);
 assert.deepEqual(await store.executeBulkRejection(plan.planId,MANAGER),{updated:3,skipped:0,total:3,remaining:0,complete:true});
 }finally{database.close();}
});
test('bulk preview rejects selected IDs from another job and uses rejection-specific errors',async()=>{
 const {store,database}=createStore();try{
 const first=await store.saveJob(jobInput()),second=await store.saveJob({...jobInput(),slug:'second-role'});
 const other=await store.acceptApplication(applicationInput(second.id));
 await assert.rejects(store.previewBulkRejection({jobId:first.id},[other.id],'Not selected.',MANAGER),{code:'bulk_selection_changed'});
 await assert.rejects(store.previewBulkRejection({},undefined,'Not selected.',MANAGER),error=>{assert.ok(error instanceof Error);assert.match(error.message,/previewing bulk rejections/);return true;});
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE '%:rejection:%'").get()!.n,0);
 }finally{database.close();}
});
test('forced competing plan commits roll back the loser and missing snapshot rows are skipped',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput());await store.acceptApplication(applicationInput(job.id));
 const plan=await store.previewBulkRejection({jobId:job.id},undefined,'Decision.',MANAGER);
 // Include a disappeared record without deleting an application with foreign-key children.
 const key='bulk_rejection:'+plan.planId;const snapshot=await store.setting<Record<string,unknown>>(key,{});
 (snapshot.entries as unknown[]).push({id:'purged-record',revision:1});await store.setSetting(key,snapshot);
 const original=store.db.batch.bind(store.db);let arrived=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 store.db.batch=async statements=>{arrived++;if(arrived===2)release();await barrier;return original(statements);};
 const results=await Promise.allSettled([store.executeBulkRejection(plan.planId,MANAGER),store.executeBulkRejection(plan.planId,MANAGER)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE id LIKE '%:rejection:%'").get()!.n,1);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_history WHERE text='Decision.'").get()!.n,1);
 assert.deepEqual(await store.executeBulkRejection(plan.planId,MANAGER),{updated:1,skipped:1,total:2,remaining:0,complete:true});
 assert.equal((database.prepare("PRAGMA table_info(hub_settings)").all().find(row=>row.name==='value'))!.notnull,1);
 }finally{database.close();}
});
