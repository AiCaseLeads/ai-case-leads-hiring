import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,currentAction} from './fixtures';
import {changeApplicationTrash,applicationTrash} from '../../lib/hub/application-lifecycle';
import {handleHubRequest} from '../../lib/hub/http';
import {reconcileLegacyPdfArchives} from '../../lib/task-runner';

test('application Trash hides recruiting and exports without deleting files or history; restore preserves stage',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  await currentAction(store,app.id,{action:'stage',stage:'Screening'},MANAGER);
  database.prepare("INSERT INTO hub_files(id,session_hash,job_id,field_path,filename,content_type,size,object_key,expires_at,uploaded_at,application_id) VALUES('retained','session',?,'resume','CV.pdf','application/pdf',10,'retained',1,1,?)").run(job.id,app.id);
  const before=await store.getApplication(app.id);
  const trashed=await changeApplicationTrash(store,app.id,'trash',before.revision,MANAGER);
  assert.equal(trashed.trashed,true);assert.equal(trashed.stage,'Withdrawn');assert.equal(trashed.files.length,1);
  assert.equal((await store.applications({jobId:job.id})).total,0);
  assert.equal((await store.applications({jobId:job.id,trash:true})).items[0].trashed,true);
  assert.deepEqual(await store.exportIds({jobId:job.id}),[]);
  assert.equal((await store.applicationCounts()).items[0].total,0);
  assert.equal((await store.overview()).counts.applications,0);
  assert.equal((await store.reports()).applications,0);
  await assert.rejects(currentAction(store,app.id,{action:'note',text:'not allowed'},MANAGER),{code:'application_in_trash'});
  const restored=await changeApplicationTrash(store,app.id,'restore',trashed.revision,MANAGER);
  assert.equal(restored.stage,'Screening');assert.equal(restored.trashed,false);assert.equal(restored.files[0].filename,'CV.pdf');
  assert.deepEqual(await store.exportIds({jobId:job.id}),[app.id]);
  assert.ok(restored.history.some(h=>h.type==='trash'));assert.ok(restored.history.some(h=>h.type==='restore'));
 }finally{database.close();}
});
test('Trash cancels unsent email and invitation links; restore never resends them',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  database.prepare("INSERT INTO hub_links(token_hash,application_id,kind,payload_json,expires_at) VALUES('synthetic-link',?,'interview','{}',?)").run(app.id,Date.now()+60000);
  const changed=await changeApplicationTrash(store,app.id,'trash',(await store.getApplication(app.id)).revision,MANAGER);
  assert.ok(database.prepare('SELECT used_at FROM hub_links WHERE token_hash=?').get('synthetic-link')!.used_at);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE application_id=? AND kind='gmail' AND status IN ('pending','failed')").get(app.id)!.n,0);
  await changeApplicationTrash(store,app.id,'restore',changed.revision,MANAGER);
  assert.ok(database.prepare('SELECT used_at FROM hub_links WHERE token_hash=?').get('synthetic-link')!.used_at);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE application_id=? AND kind='gmail' AND status IN ('pending','failed')").get(app.id)!.n,0);
 }finally{database.close();}
});
test('Trash rejects stale revisions and an active external delivery with transaction rollback',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  await assert.rejects(changeApplicationTrash(store,app.id,'trash',0,MANAGER),{code:'application_changed'});
  database.prepare("UPDATE hub_tasks SET status='running' WHERE application_id=? AND kind='gmail'").run(app.id);
  await assert.rejects(changeApplicationTrash(store,app.id,'trash',1,MANAGER),{code:'application_changed'});
  assert.equal(await applicationTrash(store,app.id),null);assert.equal((await store.getApplication(app.id)).stage,'Application Review');
 }finally{database.close();}
});
test('Trash refuses booked interviews and never deletes their calendar record',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  database.prepare("INSERT INTO hub_interviews(id,application_id,status,created_at,updated_at) VALUES('booked',?,'booked',?,?)").run(app.id,Date.now(),Date.now());
  await assert.rejects(changeApplicationTrash(store,app.id,'trash',1,MANAGER),{code:'cancel_interview_first'});
  assert.equal(await applicationTrash(store,app.id),null);assert.equal(database.prepare("SELECT status FROM hub_interviews WHERE id='booked'").get()!.status,'booked');
 }finally{database.close();}
});
test('application lifecycle API is same-origin, validates operation and restores a deleted record',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  const req=(action:string,revision:number,origin='https://jobs.example.invalid')=>new Request('https://jobs.example.invalid/api/hub/applications/'+app.id+'/lifecycle',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,expectedRevision:revision})});
  assert.equal((await handleHubRequest(req('trash',1,'https://other.invalid'),['applications',app.id,'lifecycle'],MANAGER,store)).status,403);
  assert.equal((await handleHubRequest(req('purge',1),['applications',app.id,'lifecycle'],MANAGER,store)).status,422);
  const deleted=await handleHubRequest(req('trash',1),['applications',app.id,'lifecycle'],MANAGER,store);assert.equal(deleted.status,200);
  const restored=await handleHubRequest(req('restore',2),['applications',app.id,'lifecycle'],MANAGER,store);assert.equal(restored.status,200);
  assert.equal((await store.getApplication(app.id)).trashed,false);
 }finally{database.close();}
});
test('legacy Drive PDF backfill queues once and skips current PDF archives or work in progress',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  assert.equal(await reconcileLegacyPdfArchives(store.db,store),0,'New applications are handled by their existing archive task');
  database.prepare("UPDATE hub_tasks SET status='done',result_json=? WHERE application_id=? AND kind='drive'").run(JSON.stringify({archivedRevision:1}),app.id);
  assert.equal(await reconcileLegacyPdfArchives(store.db,store),1);
  assert.equal(await reconcileLegacyPdfArchives(store.db,store),0,'No duplicate backfill or email tasks');
  database.prepare("UPDATE hub_tasks SET status='done',result_json=? WHERE id=?").run(JSON.stringify({archivedRevision:1,archiveFormat:'pdf-current-v3'}),`drive:${app.id}:pdf-current-v3:1`);
  assert.equal(await reconcileLegacyPdfArchives(store.db,store),0);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM hub_tasks WHERE application_id=? AND kind='drive' AND id LIKE '%:pdf-current-v3:%'").get(app.id)!.n,1);
 }finally{database.close();}
});
