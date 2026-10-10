import test from "node:test";
import assert from "node:assert/strict";
import {customDatabase,openSyntheticRole} from "./custom-fixture";
import {cleanupExpiredUploads} from "../lib/hiring/upload-cleanup";
test("expired orphan originals are claimed before deletion and failures retain a retryable tombstone",async()=>{
 const {database,db,store}=customDatabase();try{
  const job=await openSyntheticRole(store),now=Date.now();
  database.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES ('orphan',?,'resume','resume.pdf','application/pdf',10,'private/orphan',1,?,'synthetic')").run(job.id,now-7200000);
  let deletes=0;
  const bucket={async delete(key:string){deletes++;assert.equal(key,"private/orphan");assert.equal(database.prepare("SELECT uploaded_at FROM hub_files WHERE id='orphan'").get()!.uploaded_at,-2);if(deletes===1)throw new Error("isolated outage");}} as unknown as R2Bucket;
  assert.deepEqual(await cleanupExpiredUploads(db,bucket),{deleted:0,failed:1});
  assert.ok(database.prepare("SELECT id FROM hub_files WHERE id='orphan'").get());
  database.prepare("UPDATE hub_settings SET value='0' WHERE key='upload_cleanup_retry:orphan'").run();
  assert.deepEqual(await cleanupExpiredUploads(db,bucket),{deleted:1,failed:0});
  assert.equal(database.prepare("SELECT id FROM hub_files WHERE id='orphan'").get(),undefined);
 }finally{database.close();}
});
test("accepted application files and recent uploads are never reclaimed",async()=>{
 const {database,db,store}=customDatabase();try{
  const job=await openSyntheticRole(store),app=await store.acceptApplication({jobPostingId:job.id,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]},"a".repeat(64));
  for(const[id,applicationId,expiry]of [["accepted",app.id,Date.now()-7200000],["recent",null,Date.now()]] as const)database.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash,application_id) VALUES (?,?,'resume','resume.pdf','application/pdf',10,?,1,?,'synthetic',?)").run(id,job.id,id,expiry,applicationId);
  let deletes=0;const bucket={async delete(){deletes++;}} as unknown as R2Bucket;
  assert.deepEqual(await cleanupExpiredUploads(db,bucket),{deleted:0,failed:0});assert.equal(deletes,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_files").get()!.n,2);
 }finally{database.close();}
});


test("temporarily failing oldest objects do not starve later healthy cleanup work",async()=>{
 const {database,db,store}=customDatabase();try{
  const job=await openSyntheticRole(store);
  for(const id of ["a-fails","b-fails","c-healthy"])database.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES (?,?,'resume','resume.pdf','application/pdf',10,?,1,?,'synthetic')").run(id,job.id,id,Date.now()-7200000);
  const bucket={async delete(key:string){if(key.endsWith("fails"))throw new Error("isolated failure");}} as unknown as R2Bucket;
  assert.deepEqual(await cleanupExpiredUploads(db,bucket,Date.now()+5000,2),{deleted:0,failed:2});
  assert.deepEqual(await cleanupExpiredUploads(db,bucket,Date.now()+5000,2),{deleted:1,failed:0});
  assert.equal(database.prepare("SELECT id FROM hub_files WHERE id='c-healthy'").get(),undefined);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_files").get()!.n,2);
 }finally{database.close();}
});
