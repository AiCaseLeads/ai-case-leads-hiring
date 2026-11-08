import assert from 'node:assert/strict';
import test from 'node:test';
import {createStore,jobInput,applicationInput} from './fixtures';
import {makePdf} from '../pdf/fixtures';
import {pdfResult,extractPdf} from '../../lib/pdf/extract';
import {readResumeText} from '../../lib/pdf/http';
import {receiveUpload} from '../../lib/hiring/files';
import {sha256} from '../../lib/hiring/crypto';
import {HiringError} from '../../lib/hiring/errors';
import {claimFileText,discoverFileText,queueFileText,readCachedFileTexts,requeueFailedFileText,RESUME_TEXT_VERSION,RESUME_TEXT_LEASE_MS} from '../../lib/resume-text/cache';
import {processResumeTextBatch} from '../../lib/resume-text/worker';
import {sampleDocx,DOCX_MIME} from '../document-fixture';

async function fixture(mime='application/pdf'){
  const f=createStore(),job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
  const bytes=makePdf(),id='f'.repeat(64),uploaded_at=1000,size=bytes.length;
  await f.store.stmt('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,job.id,'_systemfield_resume','resume.pdf',mime,size,'private/'+id,uploaded_at,app.id,9999999999999,'a'.repeat(64)).run();
  let reads=0,calls=0,clock=2000;
  const bucket={get:async()=>{reads++;return {size,customMetadata:{fileId:id},body:new Response(bytes.buffer as ArrayBuffer).body!};}} as unknown as R2Bucket;
  const deps={store:f.store,bucket,now:()=>clock,extractPdf:async()=>{calls++;return pdfResult('ready','Production Linux, offline conversion and personal injury.',1);}};
  const file={id,uploaded_at,size,content_type:mime};
  return {...f,app,job,bytes,file,deps,counts:()=>({reads,calls}),advance:(ms:number)=>{clock+=ms;}};
}
test('automatic backfill extracts once, persists full text and never mutates applicant workflow',async()=>{
  const f=await fixture();
  const before=['hub_applications','hub_tasks','hub_history'].map(table=>JSON.stringify(f.database.prepare('SELECT * FROM '+table).all()));
  assert.equal((await processResumeTextBatch(f.deps)).processed,1);
  const cached=(await readCachedFileTexts(f.store,[f.file],2000)).get(f.file.id)!;
  assert.equal(cached.status,'ready');assert.equal(cached.complete,true);assert.match(cached.text,/offline conversion/);
  assert.equal((await processResumeTextBatch(f.deps)).processed,0);
  await queueFileText(f.store.db,f.file.id,2000);
  assert.deepEqual(f.counts(),{reads:1,calls:1});
  assert.deepEqual(['hub_applications','hub_tasks','hub_history'].map(table=>JSON.stringify(f.database.prepare('SELECT * FROM '+table).all())),before);
  assert.equal((await discoverFileText(f.store,2000)),0);
  f.database.close();
});
test('one global atomic lease prevents duplicate parsing across concurrent worker cycles',async()=>{
  const f=await fixture();let release!:()=>void,start!:()=>void;
  const started=new Promise<void>(resolve=>{start=resolve;}),blocked=new Promise<void>(resolve=>{release=resolve;});let parsed=0;
  const first=processResumeTextBatch({...f.deps,extractPdf:async()=>{parsed++;start();await blocked;return pdfResult('ready','Once',1);}});
  await started;
  assert.deepEqual(await processResumeTextBatch(f.deps),{processed:0,hasMore:true});
  release();await first;assert.equal(parsed,1);assert.deepEqual(f.counts(),{reads:1,calls:0});f.database.close();
});
test('identity changes hide stale text and discard in-flight completion; backfill repairs new identity',async()=>{
  const f=await fixture();await processResumeTextBatch(f.deps);
  await f.store.stmt('UPDATE hub_files SET uploaded_at=1001 WHERE id=?',f.file.id).run();
  assert.equal((await readCachedFileTexts(f.store,[{...f.file,uploaded_at:1001}],2000)).get(f.file.id)!.status,'pending');
  assert.equal((await readCachedFileTexts(f.store,[f.file],2000)).get(f.file.id)!.text,'');
  await processResumeTextBatch({...f.deps,extractPdf:async()=>{await f.store.stmt('UPDATE hub_files SET uploaded_at=1002 WHERE id=?',f.file.id).run();return pdfResult('ready','Stale must not save',1);}});
  assert.equal((await readCachedFileTexts(f.store,[{...f.file,uploaded_at:1002}],2000)).get(f.file.id)!.text,'');
  await processResumeTextBatch(f.deps);assert.equal(f.counts().calls,2);f.database.close();
});
test('transient failures retry with bounded backoff and parser contention does not consume attempts',async()=>{
  const f=await fixture();
  for(let index=0;index<8;index++){await processResumeTextBatch({...f.deps,extractPdf:async()=>{throw new HiringError('pdf_busy',429,'Busy');}});f.advance(5000);}
  const busy=f.database.prepare('SELECT * FROM hub_file_text').get()!;assert.equal(busy.attempts,0);assert.equal(busy.status,'pending');
  for(let index=0;index<5;index++){await processResumeTextBatch({...f.deps,extractPdf:async()=>pdfResult('timeout')});f.advance(60000);}
  const cached=(await readCachedFileTexts(f.store,[f.file],9999999)).get(f.file.id)!;
  assert.equal(cached.status,'failed');assert.equal(cached.errorCode,'pdf_timeout');assert.equal(cached.retryAfterSeconds,null);
  assert.equal(f.database.prepare('SELECT attempts FROM hub_file_text').get()!.attempts,5);f.database.close();
});
test('expired final lease becomes terminal instead of remaining running forever',async()=>{
  const f=await fixture();await discoverFileText(f.store,2000);await claimFileText(f.store,2000);
  await f.store.stmt('UPDATE hub_file_text SET attempts=5').run();
  assert.equal(await claimFileText(f.store,2000+RESUME_TEXT_LEASE_MS),null);
  assert.equal(f.database.prepare('SELECT status FROM hub_file_text').get()!.status,'failed');f.database.close();
});
test('timed-out object reads cancel late bodies and preserve a retryable cache state',async()=>{
  const f=await fixture();let cancel=0;
  const bucket={get:async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {size:f.file.size,customMetadata:{fileId:f.file.id},body:new ReadableStream({cancel(){cancel++;}})};}} as unknown as R2Bucket;
  await processResumeTextBatch({...f.deps,bucket,storageTimeoutMs:1});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(cancel,1);
  assert.equal(f.database.prepare('SELECT error_code FROM hub_file_text').get()!.error_code,'text_storage_timeout');assert.equal(f.counts().calls,0);f.database.close();
});
test('submitted files take priority before abandoned uploads, newest submitted first, with bounded discovery',async()=>{
  const f=await fixture();await discoverFileText(f.store,2000);
  await f.store.stmt('INSERT INTO hub_files SELECT ?,job_id,field_path,filename,content_type,size,?,2001,NULL,9999999999999,session_hash FROM hub_files WHERE id=?','e'.repeat(64),'private/new',f.file.id).run();
  await f.store.stmt('INSERT INTO hub_files SELECT ?,job_id,field_path,filename,content_type,size,?,2002,application_id,expires_at,session_hash FROM hub_files WHERE id=?','d'.repeat(64),'private/submitted',f.file.id).run();
  assert.equal(await discoverFileText(f.store,2003,1),1);assert.equal(f.database.prepare('SELECT 1 FROM hub_file_text WHERE file_id=?').get('e'.repeat(64)),undefined);
  assert.equal((await claimFileText(f.store,2003))!.file_id,'d'.repeat(64));
  await f.store.stmt("UPDATE hub_file_text SET status='ready',lease_until=0 WHERE status='running'").run();
  assert.equal((await claimFileText(f.store,2003))!.file_id,f.file.id);
  await f.store.setSetting('application_trash:'+f.app.id,{deletedAt:2002});
  assert.equal((await readCachedFileTexts(f.store,[f.file],2002)).get(f.file.id)!.text,'');
  await f.store.stmt('DELETE FROM hub_files WHERE id=?',f.file.id).run();assert.equal(f.database.prepare('SELECT 1 FROM hub_file_text WHERE file_id=?').get(f.file.id),undefined);
  const unsupported=(await readCachedFileTexts(f.store,[{...f.file,content_type:'image/png'}])).get(f.file.id)!;assert.equal(unsupported.errorCode,'text_unsupported');assert.equal(unsupported.retryAfterSeconds,null);f.database.close();
});
test('legacy PDF UI/AI text remains available while full-text backfill is pending or failed',async()=>{
  const f=await fixture(),legacy=pdfResult('ready','Previously available, bounded AI text',1,true);
  await f.store.setSetting(`pdf_text_v2_${f.file.id}_${f.file.uploaded_at}_${f.file.size}`,legacy);await queueFileText(f.store.db,f.file.id,2000);
  assert.equal((await readCachedFileTexts(f.store,[f.file],2000)).get(f.file.id)!.retryAfterSeconds,5);
  assert.equal((await readResumeText(f.app.id,f.file.id,{store:f.store})).text,legacy.text);
  await f.store.stmt("UPDATE hub_file_text SET status='failed',error_code='pdf_timeout'").run();
  assert.equal((await readResumeText(f.app.id,f.file.id,{store:f.store})).text,legacy.text);assert.deepEqual(f.counts(),{reads:0,calls:0});f.database.close();
});
test('operator can explicitly retry bounded failed extraction after an outage or Trash restore',async()=>{
  const f=await fixture();for(let index=0;index<5;index++){await processResumeTextBatch({...f.deps,extractPdf:async()=>pdfResult('timeout')});f.advance(60000);}
  assert.equal((await processResumeTextBatch(f.deps)).processed,0);assert.equal(await requeueFailedFileText(f.store,1),1);
  await processResumeTextBatch(f.deps);assert.equal((await readCachedFileTexts(f.store,[f.file])).get(f.file.id)!.status,'ready');assert.equal(await requeueFailedFileText(f.store,1),0);
  await f.store.stmt("UPDATE hub_file_text SET status='failed',error_code='text_file_unavailable'").run();await f.store.setSetting('application_trash:'+f.app.id,{deletedAt:2002});
  assert.equal(await requeueFailedFileText(f.store,1),0);await f.store.stmt('DELETE FROM hub_settings WHERE key=?','application_trash:'+f.app.id).run();assert.equal(await requeueFailedFileText(f.store,1),1);
  await processResumeTextBatch(f.deps);assert.equal((await readCachedFileTexts(f.store,[f.file])).get(f.file.id)!.complete,true);
  await f.store.stmt("UPDATE hub_file_text SET status='invalid',error_code='invalid'").run();assert.equal(await requeueFailedFileText(f.store,1),0);await assert.rejects(requeueFailedFileText(f.store,31));f.database.close();
});
test('complete old PDF cache is reused; full cache retains >30k while AI view stays bounded',async()=>{
  const f=await fixture();
  await f.store.setSetting(`pdf_text_v2_${f.file.id}_${f.file.uploaded_at}_${f.file.size}`,pdfResult('ready','Existing extracted text',1));
  await processResumeTextBatch(f.deps);assert.deepEqual(f.counts(),{reads:0,calls:0});
  const text='A'.repeat(45000);
  await f.store.stmt('UPDATE hub_file_text SET text=?',text).run();
  const ai=await readResumeText(f.app.id,f.file.id,{store:f.store,bucket:f.deps.bucket});
  assert.equal(ai.text.length,30000);assert.equal(ai.truncated,true);
  assert.equal((await readCachedFileTexts(f.store,[f.file])).get(f.file.id)!.text.length,45000);f.database.close();
});
test('a partial legacy PDF cache must be re-extracted, preserving explicit OCR incompleteness',async()=>{
  const f=await fixture();await f.store.setSetting(`pdf_text_v2_${f.file.id}_${f.file.uploaded_at}_${f.file.size}`,pdfResult('ready','Partial',30,true));
  await processResumeTextBatch({...f.deps,extractPdf:async(_bytes,timeout,options)=>{assert.equal(timeout,45000);assert.equal(options?.maxTextChars,200000);return pdfResult('ready','Full native text, some unreadable images',12,false,8,true);}});
  assert.equal(f.counts().reads,1);const cached=(await readCachedFileTexts(f.store,[f.file])).get(f.file.id)!;assert.equal(cached.ocrIncomplete,true);assert.equal(cached.complete,false);f.database.close();
});
test('successful file upload enqueues metadata immediately without parsing',async()=>{
  const f=createStore(),job=await f.store.saveJob(jobInput()),token='a'.repeat(64),session='b'.repeat(64),id=await sha256(token),bytes=makePdf(),origin='https://jobs.example.invalid';
  await f.store.stmt('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,job.id,'_systemfield_resume','resume.pdf','application/pdf',bytes.length,'private/'+id,null,null,Date.now()+100000,await sha256(session)).run();
  const form=new FormData();form.set('file',new File([bytes.buffer as ArrayBuffer],'resume.pdf',{type:'application/pdf'}));
  let writes=0;const bucket={put:async()=>{writes++;}} as unknown as R2Bucket;
  const response=await receiveUpload(new Request(origin+'/upload/'+token,{method:'POST',headers:{origin,cookie:'hiring_session='+session},body:form}),token,f.store.db,bucket,true);
  assert.equal(response.status,204);assert.equal(writes,1);const cached=f.database.prepare('SELECT * FROM hub_file_text').get()!;assert.equal(cached.status,'pending');assert.equal(cached.text,'');assert.equal(cached.parser_version,RESUME_TEXT_VERSION);f.database.close();
});
test('real PDF full-text option exceeds legacy cap while reporting truncation honestly',async()=>{
  const bytes=makePdf('Linux production experience '.repeat(100),30);
  const full=await extractPdf(bytes,45000,{maxTextChars:200000});assert.equal(full.status,'ready');assert.ok(full.text.length>30000);assert.ok(full.text.length<=200000);assert.equal(full.truncated,false);
});
test('actual Word upload is extracted to the same persistent cache and not re-read',async()=>{
  const f=await fixture(DOCX_MIME),bytes=sampleDocx();let reads=0;
  await f.store.stmt('UPDATE hub_files SET size=? WHERE id=?',bytes.length,f.file.id).run();
  const bucket={get:async()=>{reads++;return {size:bytes.length,customMetadata:{fileId:f.file.id},body:new Response(bytes as BodyInit).body!};}} as unknown as R2Bucket;
  await processResumeTextBatch({...f.deps,bucket});await processResumeTextBatch({...f.deps,bucket});
  const cached=(await readCachedFileTexts(f.store,[{...f.file,size:bytes.length}])).get(f.file.id)!;assert.equal(cached.status,'ready');assert.match(cached.text,/Synthetic resume/);assert.equal(cached.complete,true);assert.equal(reads,1);assert.equal(f.counts().calls,0);f.database.close();
});
test('plain-text résumé is cached once as strict UTF-8, rejects invalid encoding/NUL and reports truncation',async()=>{
  for(const [bytes,expected] of [[new TextEncoder().encode('Résumé: personal injury and offline conversion 😀'),'ready'],[new Uint8Array([0xff,0xfe]),'invalid'],[new Uint8Array([65,0,66]),'invalid'],[new TextEncoder().encode('x'.repeat(200001)),'ready']] as const){
    const f=await fixture('text/plain');let reads=0;await f.store.stmt('UPDATE hub_files SET size=? WHERE id=?',bytes.length,f.file.id).run();
    const bucket={get:async()=>{reads++;return {size:bytes.length,customMetadata:{fileId:f.file.id},body:new Response(bytes as BodyInit).body!};}} as unknown as R2Bucket;
    await processResumeTextBatch({...f.deps,bucket});await processResumeTextBatch({...f.deps,bucket});
    const cached=(await readCachedFileTexts(f.store,[{...f.file,size:bytes.length}])).get(f.file.id)!;assert.equal(cached.status,expected);assert.equal(reads,1);assert.equal(f.counts().calls,0);
    if(bytes.length>200000){assert.equal(cached.text.length,200000);assert.equal(cached.truncated,true);assert.equal(cached.complete,false);}else if(expected==='ready')assert.match(cached.text,/Résumé.*😀/);else assert.equal(cached.errorCode,'invalid_text_encoding');f.database.close();
  }
});
