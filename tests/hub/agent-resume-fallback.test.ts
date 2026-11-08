import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {issueAccess} from '../../lib/agent-api/access';
import {handleAgentRead} from '../../lib/agent-api/read';
import {queueFileText} from '../../lib/resume-text/cache';

async function pendingFile() {
  const {store,database}=createStore();
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  const {token}=await issueAccess(store,'fallback test',['applicants:read','files:read'],'owner');
  const fileId='a'.repeat(64),other='b'.repeat(64);
  const bytes=new TextEncoder().encode('Résumé for a targeted MCP read.');
  for(const [id,uploadedAt] of [[fileId,1],[other,2]] as const) {
    database.prepare('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,job.id,'_systemfield_resume','resume.txt','text/plain',bytes.length,'private/'+id,uploadedAt,app.id,Date.now()+1000,'c'.repeat(64));
    await queueFileText(store.db,id);
  }
  const request=()=>new Request('https://jobs.example.invalid/api/agent-read?action=file_text&applicationId='+app.id+'&fileId='+fileId,{headers:{authorization:'Bearer '+token}});
  const original=()=>({size:bytes.length,customMetadata:{fileId},body:new Response(bytes).body!});
  return {store,database,app,fileId,other,request,original};
}

test('a single read recovers an expired claim with background processing off and does not extract another pending file',async()=>{
  const f=await pendingFile();
  try {
    f.database.prepare("UPDATE hub_file_text SET status='running',lease_token='crashed',attempts=1,lease_until=1 WHERE file_id=?").run(f.fileId);
    const seen:string[]=[];
    const bucket={get:async(key:string)=>{seen.push(key);return f.original();}} as unknown as Pick<R2Bucket,'get'>;
    const response=await handleAgentRead(f.request(),f.store,bucket);
    assert.equal(response.status,200);
    const result=await response.json() as {data:{text:string;complete:boolean}};
    assert.equal(result.data.text,'Résumé for a targeted MCP read.');
    assert.equal(result.data.complete,true);
    assert.deepEqual(seen,['private/'+f.fileId]);
    assert.equal(f.database.prepare('SELECT status FROM hub_file_text WHERE file_id=?').get(f.other)?.status,'pending');
  } finally {f.database.close();}
});

test('trashing an application during fallback cannot return its extracted text',async()=>{
  const f=await pendingFile();
  try {
    const bucket={get:async()=>{await f.store.setSetting('application_trash:'+f.app.id,{deletedAt:Date.now()});return f.original();}} as unknown as Pick<R2Bucket,'get'>;
    const response=await handleAgentRead(f.request(),f.store,bucket);
    assert.equal(response.status,404);
    assert.equal(f.database.prepare('SELECT text FROM hub_file_text WHERE file_id=?').get(f.fileId)?.text,'');
  } finally {f.database.close();}
});

test('a foreground extraction finishing after the read deadline is cached for the retry',async()=>{
  const f=await pendingFile();
  let release!:()=>void,storageReads=0;
  const paused=new Promise<void>(resolve=>{release=resolve;});
  const bucket={get:async()=>{storageReads++;await paused;return f.original();}} as unknown as Pick<R2Bucket,'get'>;
  try {
    const response=await handleAgentRead(f.request(),f.store,bucket,{timeoutMs:100});
    assert.equal(response.status,504);
    assert.equal(response.headers.get('Retry-After'),'5');
    release();
    const retry=await handleAgentRead(f.request(),f.store,bucket);
    assert.equal(retry.status,200);
    const body=await retry.json() as {data:{text:string}};
    assert.equal(body.data.text,'Résumé for a targeted MCP read.');
    assert.equal(storageReads,1);
  } finally {release();f.database.close();}
});
