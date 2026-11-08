#!/usr/bin/env node
// Read-only release diagnostics. Never emit paths, SQL, credentials or applicant data.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const PARSER_VERSION='resume_text_v1';
const supported=['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'];
class ReleaseVerificationError extends Error {constructor(code){super(code);this.code=code;}}
export async function verifyRelease({databasePath,healthUrl,fetcher=fetch,now=Date.now()}={}){
 let health;
 try{const response=await fetcher(healthUrl,{signal:AbortSignal.timeout(5000)});health=await response.json();if(!response.ok)throw Error('health');}catch{throw new ReleaseVerificationError('release_health_unavailable');}
 if(health?.status!=='ready'||health.checks?.storage!==true||health.checks?.background!==true||health.checks?.backgroundEnabled!==true)throw new ReleaseVerificationError('release_background_not_ready');
 let db;
 try{
  db=new DatabaseSync(databasePath,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');
  const columns=new Set(db.prepare('PRAGMA table_info(hub_file_text)').all().map(row=>row.name));
  for(const column of ['file_id','uploaded_at','size','content_type','parser_version','status','truncated','ocr_incomplete','lease_until','updated_at'])if(!columns.has(column))throw new ReleaseVerificationError('release_cache_schema_missing');
  const row=db.prepare(`SELECT COUNT(*) totalFiles,
   COALESCE(SUM(c.file_id IS NULL),0) undiscovered,
   COALESCE(SUM(c.status='pending'),0) pending,
   COALESCE(SUM(c.status='running'),0) running,
   COALESCE(SUM(c.status='ready' AND c.truncated=0 AND c.ocr_incomplete=0),0) ready,
   COALESCE(SUM(c.status='ready' AND (c.truncated<>0 OR c.ocr_incomplete<>0)),0) partial,
   COALESCE(SUM(c.file_id IS NOT NULL AND c.status NOT IN ('ready','pending','running')),0) failed
   FROM hub_files f LEFT JOIN hub_file_text c ON c.file_id=f.id AND c.uploaded_at=f.uploaded_at AND c.size=f.size AND c.content_type=f.content_type AND c.parser_version=?
   WHERE f.uploaded_at>0 AND f.content_type IN (${supported.map(()=>'?').join(',')})
   AND (f.application_id IS NULL AND f.expires_at>? OR f.application_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hub_settings t WHERE t.key='application_trash:'||f.application_id))`).get(PARSER_VERSION,...supported,now);
  const counts=Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value)]));
  return {schemaVersion:1,storageReady:true,backgroundReady:true,backgroundEnabled:true,cacheSchemaReady:true,fileTextBackfill:{...counts,state:counts.undiscovered+counts.pending+counts.running>0?'in_progress':counts.failed+counts.partial>0?'finished_with_exceptions':'complete'}};
 }catch(error){if(error instanceof ReleaseVerificationError)throw error;throw new ReleaseVerificationError('release_cache_verification_failed');}
 finally{db?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await verifyRelease({databasePath:resolve(process.env.DATA_DIR||'/data','hiring.sqlite'),healthUrl:'http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health'});console.log(JSON.stringify(result));}
 catch(error){console.log(JSON.stringify({error:error instanceof ReleaseVerificationError?error.code:'release_verification_failed'}));process.exitCode=1;}
}
