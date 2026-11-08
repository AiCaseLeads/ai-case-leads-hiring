import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SQLiteD1Database} from '../../lib/railway/sqlite';
import {FileObjectStore} from '../../lib/railway/object-store';
import {HubStore} from '../../lib/hub/store';
import {jobInput,applicationInput} from '../hub/fixtures';
import {makePdf} from '../pdf/fixtures';
import {processResumeTextBatch} from '../../lib/resume-text/worker';
import {readCachedFileTexts} from '../../lib/resume-text/cache';

test('cache migration preserves existing applicant records and backfilled text survives a real SQLite restart',async()=>{
 const root=mkdtempSync(path.join(realpathSync(tmpdir()),'hiring-resume-upgrade-')),migrations=path.resolve('drizzle'),old=path.join(root,'old-migrations');mkdirSync(path.join(old,'meta'),{recursive:true});
 const journal=JSON.parse(readFileSync(path.join(migrations,'meta/_journal.json'),'utf8')) as {entries:{idx:number;tag:string}[]};
 const previous={...journal,entries:journal.entries.filter(entry=>entry.tag!=='0013_file_text_cache')};
 writeFileSync(path.join(old,'meta/_journal.json'),JSON.stringify(previous));
 for(const {tag} of previous.entries)writeFileSync(path.join(old,tag+'.sql'),readFileSync(path.join(migrations,tag+'.sql')));
 const filename=path.join(root,'hiring.sqlite');let db=new SQLiteD1Database(filename);
 try{
  db.migrate(old);let store=new HubStore(db.asD1(),{sessionHash:'a'.repeat(64),origin:'https://jobs.example.invalid'});
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),fileId='9'.repeat(64),bytes=makePdf('Built offline conversion and personal injury systems.');
  await store.stmt('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',fileId,job.id,'_systemfield_resume','resume.pdf','application/pdf',bytes.length,'applications/synthetic',1,app.id,Date.now()+100000,'a'.repeat(64)).run();
  const records=JSON.stringify(db.connection.prepare('SELECT * FROM hub_applications').all());
  db.migrate(migrations);assert.equal(JSON.stringify(db.connection.prepare('SELECT * FROM hub_applications').all()),records);
  const objects=new FileObjectStore(path.join(root,'objects'));await objects.put('applications/synthetic',bytes,{customMetadata:{fileId}});
  let reads=0;const bucket={get:async(key:string)=>{reads++;return objects.get(key);}} as unknown as R2Bucket;
  assert.equal((await processResumeTextBatch({store,bucket})).processed,1);assert.equal(reads,1);
  db.close();db=new SQLiteD1Database(filename);db.migrate(migrations);store=new HubStore(db.asD1());
  assert.equal((await processResumeTextBatch({store,bucket})).processed,0);assert.equal(reads,1);
  const cached=(await readCachedFileTexts(store,[{id:fileId,uploaded_at:1,size:bytes.length,content_type:'application/pdf'}])).get(fileId)!;
  assert.equal(cached.status,'ready');assert.equal(cached.complete,true);assert.match(cached.text,/offline conversion/);
  assert.equal(JSON.stringify(db.connection.prepare('SELECT * FROM hub_applications').all()),records);
  assert.throws(()=>db.migrate(old),/migration_hash_drift/,'older images require a compatible roll-forward after the additive migration');
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
