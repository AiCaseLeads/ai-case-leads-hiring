import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {csvCell,downloadApplications,safeFilename,zipStream} from '../../lib/hub/exports';
import {handleHubRequest} from '../../lib/hub/http';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('CSV escapes formula cells and ZIP filenames cannot traverse directories',()=>{
 assert.equal(csvCell(' =HYPERLINK("x")'),'"\' =HYPERLINK(""x"")"');assert.equal(csvCell('a,b\nc'),'"a,b\nc"');assert.equal(safeFilename('../../résumé.pdf'),'__.._résumé.pdf');
});
test('download requires one job, preserves answers and rejects cross-job selected IDs',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),other=await store.saveJob(jobInput());
 const a=await store.acceptApplication(applicationInput(job.id)),b=await store.acceptApplication(applicationInput(other.id));
 const request=(query:string)=>new Request('https://jobs.example.invalid/api/hub/applications-export?format=csv'+query);
 await assert.rejects(downloadApplications(request(''),store,{}),{code:'export_job_required'});
 await assert.rejects(downloadApplications(request('&ids='+b.id),store,{jobId:job.id}),{code:'export_selection_changed'});
 const response=await downloadApplications(request('&ids='+a.id),store,{jobId:job.id});
 assert.equal(response.headers.get('X-Application-Count'),'1');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const csv=await response.text();assert.match(csv,/Application answers JSON/);assert.match(csv,/experience/);assert.match(csv,new RegExp(a.id));assert.ok(!csv.includes(b.id));
 const counts=await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/application-counts'),['application-counts'],MANAGER,store);
 assert.equal(counts.status,200);assert.equal((await store.applicationCounts()).items.find(row=>row.jobId===job.id)?.total,1);
 }finally{database.close();}
});
test('streamed ZIP contains valid CRCs, Unicode filenames and independent entries',async()=>{
 async function* entries(){yield {name:'résumé.pdf',data:(async function*(){yield new TextEncoder().encode('first');yield new TextEncoder().encode('second');})()};yield {name:'empty.txt',data:(async function*(){})()};}
 const chunks=[];for await(const chunk of zipStream(entries()))chunks.push(chunk);
 const dir=mkdtempSync(join(tmpdir(),'hiring-export-'));try{const path=join(dir,'test.zip');writeFileSync(path,Buffer.concat(chunks));const result=execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("résumé.pdf")==b"firstsecond"; assert z.read("empty.txt")==b""',path]);assert.equal(result.length,0);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('top 10 excludes missing, stale and terminal AI matches and shares export order',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput());database.prepare('UPDATE hub_jobs SET ai_match_enabled=1 WHERE id=?').run(job.id);
 const ids=[];for(let n=0;n<14;n++){const app=await store.acceptApplication(applicationInput(job.id));ids.push(app.id);}
 // Schema defaults let fixtures represent completed provider results without invoking it.
 for(let n=0;n<ids.length;n++)database.prepare("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,updated_at) VALUES(?,?,?,'ready',?,?)").run(ids[n],job.id,job.formVersion,n,Date.now());
 database.prepare("UPDATE hub_applications SET stage='Rejected' WHERE id=?").run(ids[13]);database.prepare("UPDATE hub_ai_matches SET form_version=form_version-1 WHERE application_id=?").run(ids[12]);database.prepare("UPDATE hub_ai_matches SET score=NULL,status='pending' WHERE application_id=?").run(ids[11]);
 const filters={jobId:job.id,sort:'ai_match_desc' as const,top:10 as const};
 const listed=await store.applications(filters),exported=await store.exportIds(filters);
 assert.equal(listed.total,10);assert.equal(exported.length,10);assert.equal(exported[0],ids[10]);assert.deepEqual(listed.items.map(row=>row.id),exported);
 assert.equal((await store.applications({...filters,page:2})).items.length,0);
 }finally{database.close();}
});
test('ZIP missing originals are reported and application data stays available',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 database.prepare("INSERT INTO hub_files(id,session_hash,job_id,field_path,filename,content_type,size,object_key,expires_at,uploaded_at,application_id) VALUES('missing','test',?,'resume','missing.pdf','application/pdf',10,'missing-key',1,1,?)").run(job.id,app.id);
 const bucket={get:async()=>null} as unknown as Pick<R2Bucket,'get'>;
 const response=await downloadApplications(new Request('https://jobs.example.invalid/api/hub/applications-export?format=zip'),store,{jobId:job.id},bucket);
 const dir=mkdtempSync(join(tmpdir(),'hiring-export-'));try{const path=join(dir,'test.zip');writeFileSync(path,Buffer.from(await response.arrayBuffer()));execFileSync('python3',['-c','import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read("manifest.json")); assert len(m["missingFiles"])==1; assert m["includedFiles"]==0; assert "applications.csv" in z.namelist()',path]);}finally{rmSync(dir,{recursive:true,force:true});}
 }finally{database.close();}
});
test('1000 applications export incrementally without accumulating answers or file bodies',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 const row=database.prepare('SELECT * FROM hub_applications WHERE id=?').get(app.id)!;
 const columns=Object.keys(row),insert=database.prepare(`INSERT INTO hub_applications (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
 database.exec('BEGIN');for(let n=1;n<1000;n++){const id=crypto.randomUUID();insert.run(...columns.map(column=>column==='id'||column==='submission_key_hash'?id:row[column]));}database.exec('COMMIT');
 let read=0;const original=store.exportRecord.bind(store);store.exportRecord=async(id)=>{read++;return original(id);};
 const response=await downloadApplications(new Request('https://jobs.example.invalid/api/hub/applications-export?format=csv'),store,{jobId:job.id});
 assert.equal(response.headers.get('X-Application-Count'),'1000');assert.ok(read<=1,'No eager full-cohort materialization');
 const reader=response.body!.getReader();let chunks=0;while(!(await reader.read()).done)chunks++;assert.equal(chunks,1001);assert.equal(read,1000);
 }finally{database.close();}
});
