import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyRelease,PARSER_VERSION} from '../../scripts/aws/verify-release.mjs';
const health=()=>Promise.resolve(Response.json({status:'ready',checks:{storage:true,background:true,backgroundEnabled:true}}));
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'release-verify-')),path=join(directory,'hiring.sqlite');const db=new DatabaseSync(path);db.exec('CREATE TABLE hub_files(id TEXT PRIMARY KEY,uploaded_at INTEGER,size INTEGER,content_type TEXT,application_id TEXT,expires_at INTEGER,filename TEXT); CREATE TABLE hub_settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE hub_applications(id TEXT PRIMARY KEY,email TEXT,created_at INTEGER,job_id TEXT);');db.exec(await readFile(new URL('../../drizzle/0013_file_text_cache.sql',import.meta.url),'utf8'));return {db,path,directory};}
function file(f,id,{status='ready',version=PARSER_VERSION,size=10,uploaded=1,truncated=0,ocr=0,app='app-1',expires=99999,type='application/pdf'}={}){f.db.prepare('INSERT INTO hub_files VALUES(?,?,?,?,?,?,?)').run(id,uploaded,size,type,app,expires,'PRIVATE-RESUME-NAME.pdf');if(status)f.db.prepare('INSERT INTO hub_file_text(file_id,uploaded_at,size,content_type,parser_version,status,text,truncated,ocr_incomplete,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,uploaded,size,type,version,status,'PRIVATE RESUME TEXT',truncated,ocr,'PRIVATE PROVIDER ERROR',1,1);}
test('read-only release snapshot reports bounded aggregates and pending backfill without private fields',async()=>{
 const f=await fixture();try{
  file(f,'ready');file(f,'partial',{truncated:1});file(f,'pending',{status:'pending'});file(f,'running',{status:'running'});file(f,'failed',{status:'no_text'});file(f,'missing',{status:null});file(f,'stale',{version:'older_parser'});file(f,'expired',{status:null,app:null,expires:1});file(f,'trashed',{status:null,app:'trash'});file(f,'image',{status:null,type:'image/png'});f.db.prepare('INSERT INTO hub_settings VALUES(?,?)').run('application_trash:trash','PRIVATE');f.db.close();
  const before=await readFile(f.path),result=await verifyRelease({databasePath:f.path,healthUrl:'http://test/health',fetcher:health,now:10});
  assert.deepEqual(result.fileTextBackfill,{totalFiles:7,undiscovered:2,pending:1,running:1,ready:1,partial:1,failed:1,state:'in_progress'});
  assert.equal(result.backgroundReady,true);assert.deepEqual(await readFile(f.path),before);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|provider|filename|file_id|email|application_id|path/);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('finished exceptions remain visible rather than failing deployment or claiming complete text',async()=>{const f=await fixture();try{file(f,'partial',{ocr:1});file(f,'failed',{status:'invalid'});f.db.close();const result=await verifyRelease({databasePath:f.path,healthUrl:'http://test',fetcher:health});assert.equal(result.fileTextBackfill.state,'finished_with_exceptions');assert.equal(result.fileTextBackfill.failed,1);}finally{await rm(f.directory,{recursive:true,force:true});}});
test('missing cache schema and disabled or unavailable background fail with fixed safe codes',async()=>{
 const f=await fixture();try{f.db.exec('DROP TABLE hub_file_text');f.db.close();await assert.rejects(verifyRelease({databasePath:f.path,healthUrl:'http://test',fetcher:health}),{message:'release_cache_schema_missing'});
 await assert.rejects(verifyRelease({databasePath:f.path,healthUrl:'http://test',fetcher:async()=>Response.json({status:'ready',checks:{storage:true,background:true,backgroundEnabled:false}})}),{message:'release_background_not_ready'});
 await assert.rejects(verifyRelease({databasePath:f.path,healthUrl:'http://test',fetcher:()=>{throw Error('PRIVATE TOKEN AND PROVIDER BODY');}}),{message:'release_health_unavailable'});
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('release verifier parser version follows the runtime cache version',async()=>{const source=await readFile(new URL('../../lib/resume-text/cache.ts',import.meta.url),'utf8');assert.ok(source.includes(`RESUME_TEXT_VERSION = '${PARSER_VERSION}'`));});
