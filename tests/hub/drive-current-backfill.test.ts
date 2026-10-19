import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {reconcileLegacyPdfArchives} from '../../lib/task-runner';

test('current-only Drive migration is bounded, idempotent, and never replays mail or applicant decisions',async()=>{
 const {store,database,db}=createStore();try{
 const job=await store.saveJob(jobInput());const ids:string[]=[];
 for(let n=0;n<14;n++){const app=await store.acceptApplication({...applicationInput(job.id),submissionKey:crypto.randomUUID()});ids.push(app.id);}
 database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");
 for(const id of ids)await db.prepare("INSERT INTO hub_tasks(id,application_id,kind,payload_json,status,attempts,run_after,result_json,created_at,updated_at) VALUES(?,?,'drive',?,'done',1,0,?,1,1)").bind('old:'+id,id,JSON.stringify({applicationId:id}),JSON.stringify({archiveFormat:'pdf-v2',archivedRevision:1})).run();
 // A completed migration and an existing pending task are excluded.
 await db.prepare("UPDATE hub_tasks SET result_json=? WHERE application_id=?").bind(JSON.stringify({archiveFormat:'pdf-current-v3',archivedRevision:1}),ids[0]).run();
 await db.prepare("UPDATE hub_tasks SET status='pending' WHERE application_id=?").bind(ids[1]).run();
 const before=database.prepare('SELECT id,stage,revision FROM hub_applications ORDER BY id').all();
 assert.equal(await reconcileLegacyPdfArchives(db,store),10);
 assert.equal(await reconcileLegacyPdfArchives(db,store),0,'Do not grow migration backlog while a batch remains pending');
 database.exec("UPDATE hub_tasks SET status='done',result_json='{\"archiveFormat\":\"pdf-current-v3\",\"archivedRevision\":1}' WHERE id LIKE 'drive:%:pdf-current-v3:%'");
 assert.equal(await reconcileLegacyPdfArchives(db,store),2);
 assert.equal(await reconcileLegacyPdfArchives(db,store),0);
 assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE kind!='drive'").get()!.n,0);
 assert.equal(database.prepare('SELECT count(*) n FROM hub_communications').get()!.n,0);
 assert.deepEqual(database.prepare('SELECT id,stage,revision FROM hub_applications ORDER BY id').all(),before);
 const tasks=database.prepare("SELECT application_id,payload_json FROM hub_tasks WHERE id LIKE 'drive:%:pdf-current-v3:%'").all();
 assert.equal(tasks.length,12);assert.ok(tasks.every(t=>t.application_id!==ids[0]&&t.application_id!==ids[1]));
 }finally{database.close();}
});
