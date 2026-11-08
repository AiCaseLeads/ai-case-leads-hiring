import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, symlinkSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SQLiteD1Database } from "../../lib/railway/sqlite";
import { FileObjectStore, MAX_OBJECT_BYTES } from "../../lib/railway/object-store";
import { initializeRailwayStorage, closeRailwayStorage, getRailwayStorage, env, healthRailwayStorage } from "../../lib/railway/bindings";
import { HubStore } from "../../lib/hub/store";
import { jobInput, applicationInput, MANAGER, currentAction, addReviewedNote } from "../hub/fixtures";
import { createRailwayBackup } from "../../scripts/railway-backup.mjs";

const migrations = path.resolve("drizzle");
function temporary() { return mkdtempSync(path.join(realpathSync(os.tmpdir()), "hiring-railway-")); }
function journal(directory: string, entries: Array<[string,string]>) {
  mkdirSync(path.join(directory,"meta"),{recursive:true});
  writeFileSync(path.join(directory,"meta","_journal.json"),JSON.stringify({entries:entries.map(([name],idx)=>({idx,tag:name}))}));
  for(const [name,sql] of entries)writeFileSync(path.join(directory,name+".sql"),sql);
}
test("real SQLite preserves RETURNING, changes(), foreign keys and an entire losing CAS batch",async()=>{
  const root=temporary(),db=new SQLiteD1Database(path.join(root,"test.sqlite"));
  try {
    await db.exec("CREATE TABLE lock(id TEXT PRIMARY KEY,revision INTEGER NOT NULL); CREATE TABLE effect(id TEXT PRIMARY KEY); INSERT INTO lock VALUES('one',1);");
    const update=()=>db.prepare("UPDATE lock SET revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END WHERE id='one' RETURNING revision").bind(1);
    const results=await db.batch([update(),db.prepare("INSERT INTO effect SELECT 'won' WHERE changes()=1")]);
    assert.equal(results[0].meta.changes,1);assert.deepEqual(results[0].results,[{revision:2}]);assert.equal(results[1].meta.changes,1);
    await assert.rejects(db.batch([db.prepare("INSERT INTO effect VALUES('must-roll-back')"),update()]));
    assert.equal(await db.prepare("SELECT id FROM effect WHERE id='must-roll-back'").first(),null);
    assert.equal(await db.prepare("SELECT revision FROM lock").first<number>("revision"),2);
    assert.deepEqual(await db.prepare("SELECT id,revision FROM lock").raw({columnNames:true}),[["id","revision"],["one",2]]);
    assert.equal((await db.prepare("PRAGMA foreign_keys").first<{foreign_keys:number}>())!.foreign_keys,1);
    assert.equal((await db.prepare("PRAGMA journal_mode").first<{journal_mode:string}>())!.journal_mode,"wal");
    assert.equal((await db.prepare("PRAGMA busy_timeout").first<{timeout:number}>())!.timeout,5000);
    assert.throws(()=>db.prepare("SELECT ?").bind(undefined),/binding_unsupported/);
    const foreign=new SQLiteD1Database(path.join(root,"foreign.sqlite"));
    try {await assert.rejects(db.batch([foreign.prepare("SELECT 1")]));}finally{foreign.close();}
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});
test("versioned migrations survive restart, reject historical drift, and atomically roll back a bad append",async()=>{
  const root=temporary(),folder=path.join(root,"migrations");mkdirSync(folder);
  const initial:[string,string][]=[["0000_initial","CREATE TABLE accepted(id TEXT PRIMARY KEY);"]];journal(folder,initial);
  let db=new SQLiteD1Database(path.join(root,"test.sqlite"));
  try {
    db.migrate(folder);await db.prepare("INSERT INTO accepted VALUES(?)").bind("persisted").run();db.close();
    db=new SQLiteD1Database(path.join(root,"test.sqlite"));db.migrate(folder);
    assert.deepEqual(await db.prepare("SELECT id FROM accepted").first(),{id:"persisted"});
    writeFileSync(path.join(folder,"0000_initial.sql"),initial[0][1]+" -- changed");assert.throws(()=>db.migrate(folder),/migration_hash_drift/);
    journal(folder,[...initial,["0001_append","CREATE TABLE must_rollback(id TEXT); INSERT INTO table_that_does_not_exist VALUES(1);"]]);
    assert.throws(()=>db.migrate(folder),/no such table/);
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='must_rollback'").first(),null);
    assert.equal(await db.prepare("SELECT count(*) n FROM railway_migrations").first<number>("n"),1);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test("actual hiring acceptance, receipts and task CAS persist through adapter restart",async()=>{
  const root=temporary();let db=new SQLiteD1Database(path.join(root,"hiring.sqlite"));
  try {
    db.migrate(migrations);let store=new HubStore(db.asD1(),{sessionHash:"a".repeat(64),origin:"https://jobs.example.invalid"});const job=await store.saveJob(jobInput()),input=applicationInput(job.id);
    const results=await Promise.all(Array.from({length:100},()=>store.acceptApplication(input)));
    assert.equal(new Set(results.map(result=>result.id)).size,1);const id=results[0].id;
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM hub_applications").first<number>("n"),1);
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM hub_tasks").first<number>("n"),2);
    await addReviewedNote(store,id);
    const revision=(await store.getApplication(id)).revision;
    const decisions=await Promise.allSettled([store.action(id,{action:"stage",stage:"Offer",expectedRevision:revision},MANAGER),store.action(id,{action:"reject",reason:"Synthetic",expectedRevision:revision},MANAGER)]);
    assert.equal(decisions.filter(decision=>decision.status==="fulfilled").length,1);
    await assert.rejects(db.prepare("INSERT INTO hub_scorecards(id,application_id,actor,score,criteria,text,created_at) VALUES('invalid','missing','synthetic',1,'','',0)").run());
    db.close();db=new SQLiteD1Database(path.join(root,"hiring.sqlite"));db.migrate(migrations);store=new HubStore(db.asD1(),{sessionHash:"a".repeat(64),origin:"https://jobs.example.invalid"});
    const detail=await store.getApplication(id);assert.ok(["Offer","Rejected"].includes(detail.stage),"exactly one concurrent disposition persists");assert.equal(detail.revision,revision+1);
    assert.equal((statSync(path.join(root,"hiring.sqlite")).mode&0o777),0o600);
    await currentAction(store,id,{action:"note",text:"After real adapter restart"},MANAGER);assert.ok((await store.getApplication(id)).notes.some(note=>note.text==="After real adapter restart"));
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test("private originals persist metadata, exact bytes and streaming behavior across restart",async()=>{
  const root=temporary(),directory=path.join(root,"objects"),key="applications/synthetic-file";
  try {
    let objects=new FileObjectStore(directory);const bytes=new TextEncoder().encode("Synthetic original document");
    const original=await objects.put(key,bytes,{httpMetadata:{contentType:"application/pdf"},customMetadata:{fileId:"synthetic-file"}});
    objects=new FileObjectStore(directory);const head=await objects.head(key),saved=await objects.get(key);assert.ok(saved);
    assert.equal(head!.version,original.version);assert.equal(saved.customMetadata!.fileId,"synthetic-file");assert.equal(saved.httpMetadata!.contentType,"application/pdf");
    const headers=new Headers();saved.writeHttpMetadata(headers);assert.equal(headers.get("content-type"),"application/pdf");
    assert.equal(saved.bodyUsed,false);assert.deepEqual(new Uint8Array(await saved.arrayBuffer()),bytes);assert.equal(saved.bodyUsed,true);
    const stream=await objects.get(key);assert.deepEqual(new Uint8Array(await new Response(stream!.body).arrayBuffer()),bytes);
    const hash=createHash("sha256").update(key).digest("hex"),filename=path.join(directory,hash.slice(0,2),hash+".object");
    assert.equal(statSync(filename).mode&0o777,0o600);assert.equal(statSync(directory).mode&0o777,0o700);assert.equal(await objects.health(),true);
    await objects.delete(key);await objects.delete(key);assert.equal(await objects.head(key),null);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("object writes are atomic, bounded, reject traversal, and never follow filesystem symlinks",async()=>{
  const root=temporary(),directory=path.join(root,"objects"),objects=new FileObjectStore(directory),key="applications/synthetic";
  try {
    await objects.put(key,new Uint8Array([1]),{customMetadata:{fileId:"one"}});
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([2]));controller.error(new Error("isolated stream interruption"));}});
    await assert.rejects(objects.put(key,stream));assert.deepEqual(await (await objects.get(key))!.bytes(),new Uint8Array([1]));
    await assert.rejects(objects.put(key,new Uint8Array(MAX_OBJECT_BYTES+1)),/object_too_large/);
    for(const bad of ["../private","/absolute","a/../b","a\\b","a//b","a\x00b"]){await assert.rejects(objects.get(bad),/object_key_invalid/);await assert.rejects(objects.put(bad,"synthetic"),/object_key_invalid/);}
    const hash=createHash("sha256").update(key).digest("hex"),folder=path.join(directory,hash.slice(0,2)),filename=path.join(folder,hash+".object"),outside=path.join(root,"outside");writeFileSync(outside,"private outside file");
    rmSync(filename);symlinkSync(outside,filename);await assert.rejects(objects.get(key));await assert.rejects(objects.put(key,"synthetic"));await assert.rejects(objects.delete(key));assert.equal(readFileSync(outside,"utf8"),"private outside file");
    rmSync(folder,{recursive:true});symlinkSync(root,folder);await assert.rejects(objects.get(key),/object_directory_unsafe/);
    assert.ok(readdirSync(directory).every(name=>!name.startsWith(".tmp-")));
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("production bindings require the actual Railway mount, share a lazy singleton and survive restart",async()=>{
  const root=temporary(),previous={NODE_ENV:process.env.NODE_ENV,RAILWAY_DEPLOYMENT_ID:process.env.RAILWAY_DEPLOYMENT_ID,RAILWAY_VOLUME_MOUNT_PATH:process.env.RAILWAY_VOLUME_MOUNT_PATH};
  try {
    closeRailwayStorage();process.env.RAILWAY_DEPLOYMENT_ID="synthetic";delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    assert.throws(()=>initializeRailwayStorage({dataDir:root,production:true,migrationsDir:migrations}),/durable_volume_required/);
    process.env.RAILWAY_VOLUME_MOUNT_PATH=path.join(root,"missing");assert.throws(()=>initializeRailwayStorage({dataDir:root,production:true}),/durable_volume_required/);
    process.env.RAILWAY_VOLUME_MOUNT_PATH=root;const storage=initializeRailwayStorage({dataDir:root,production:true,migrationsDir:migrations});
    assert.equal(getRailwayStorage(),storage);assert.equal(env.DB,storage.DB);assert.equal({...env}.BUCKET,storage.BUCKET);assert.equal(await healthRailwayStorage(),true);
    await storage.DB.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES('synthetic','1',0)").run();closeRailwayStorage();
    const reopened=initializeRailwayStorage({dataDir:root,production:true,migrationsDir:migrations});assert.equal(await reopened.DB.prepare("SELECT value FROM hub_settings WHERE key='synthetic'").first<string>("value"),"1");
  }finally{closeRailwayStorage();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(root,{recursive:true,force:true});}
});
test("online backup contains committed WAL records, is private and never overwrites a destination",async()=>{
  const root=temporary(),db=new SQLiteD1Database(path.join(root,"hiring.sqlite")),destination=path.join(root,"backups","snapshot.sqlite");
  try {
    await db.exec("CREATE TABLE accepted(id TEXT PRIMARY KEY)");await db.prepare("INSERT INTO accepted VALUES(?)").bind("committed-wal").run();
    assert.equal(await createRailwayBackup({dataDir:root,destination}),destination);
    const backup=new DatabaseSync(destination,{readOnly:true});try{assert.equal(backup.prepare("SELECT id FROM accepted").get()!.id,"committed-wal");assert.equal(backup.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");}finally{backup.close();}
    assert.equal(statSync(destination).mode&0o777,0o600);await assert.rejects(createRailwayBackup({dataDir:root,destination}),/destination_exists/);
    assert.deepEqual(readdirSync(path.dirname(destination)),["snapshot.sqlite"]);
    const unsafe=path.join(root,"symlink.sqlite");symlinkSync(destination,unsafe);assert.throws(()=>new SQLiteD1Database(unsafe),/sqlite_file_unsafe/);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test("archive migration preserves existing applications and legacy Drive identity on upgrade", async()=>{
  const root=temporary(),folder=path.join(root,"old-migrations");mkdirSync(folder);
  const entries=JSON.parse(readFileSync(path.join(migrations,"meta/_journal.json"),"utf8")).entries as {tag:string}[];
  journal(folder,entries.slice(0,6).map(({tag})=>[tag,readFileSync(path.join(migrations,tag+".sql"),"utf8")]));
  const db=new SQLiteD1Database(path.join(root,"hiring.sqlite"));
  try {
    db.migrate(folder);
    db.connection.exec("INSERT INTO hub_jobs(id,slug,title,department,description_html,rejection_template,created_at,updated_at) VALUES('old-job','old-job','Creative Strategist','','','thanks',1,1)");
    db.connection.exec("INSERT INTO hub_applications(id,submission_key_hash,fingerprint,session_hash,job_id,job_title,form_version,name,email,stage,qualification,qualification_json,answers_json,fields_json,utm_json,source,drive_folder_id,drive_folder_url,stage_entered_at,created_at,updated_at) VALUES('old-app','key','fingerprint','session','old-job','Creative Strategist',1,'Test','test@example.invalid','Application Review','review','[]','[]','[]','{}','Direct','legacy-folder','https://drive.google.com/drive/folders/legacy-folder',1,1,1)");
    db.migrate(migrations);db.migrate(migrations);
    const app=await new HubStore(db.asD1()).getApplication('old-app');
    assert.equal(app.archiveProject,undefined);assert.equal(app.archiveCountry,undefined);assert.equal(app.hiringRound,undefined);
    assert.equal(app.driveFolderUrl,'https://drive.google.com/drive/folders/legacy-folder');
    assert.equal(app.jobId,'old-job');
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test("the previous image can receive applications with the exact next response-check schema and rejects other migration drift",async()=>{
  const root=temporary(), filename=path.join(root,"test.sqlite");
  const base=path.join(root,"baseline"),next=path.join(root,"next");
  const journalFile=path.join(migrations,"meta","_journal.json");
  const baselineJournal=JSON.parse(readFileSync(journalFile,"utf8")) as {entries:{tag:string}[]};
  const oldEntries=baselineJournal.entries.slice(0,14);
  const initial=oldEntries.map(e=>[e.tag,readFileSync(path.join(migrations,e.tag+".sql"),"utf8")] as [string,string]);
  const name="0015_response_checks.sql";
  const sql=readFileSync(path.join("tests","railway","fixtures",name),"utf8");
  let db=new SQLiteD1Database(filename);
  try {
    journal(base,initial);journal(next,[...initial,["0015_response_checks",sql]]);
    db.migrate(base);
    const options={sessionHash:"a".repeat(64),origin:"https://jobs.example.invalid"};
    const original=new HubStore(db.asD1(),options);
    const job=await original.saveJob(jobInput());
    const first=await original.acceptApplication(applicationInput(job.id));
    db.migrate(next);
    const observed='{"version":1}';
    db.connection.prepare("UPDATE hub_applications SET response_entry_json=? WHERE id=?").run(observed,first.id);
    const history=()=>db.connection.prepare("SELECT * FROM railway_migrations ORDER BY position").all();
    const expected=history();
    db.close();db=new SQLiteD1Database(filename);
    db.migrate(base);
    assert.deepEqual(history(),expected);
    assert.equal(db.connection.prepare("SELECT response_entry_json FROM hub_applications WHERE id=?").get(first.id)?.response_entry_json,observed);
    const second=await new HubStore(db.asD1(),options).acceptApplication(applicationInput(job.id));
    assert.equal(db.connection.prepare("SELECT response_entry_json FROM hub_applications WHERE id=?").get(second.id)?.response_entry_json,null);
    for (const tamper of [
      "UPDATE railway_migrations SET sha256='changed' WHERE position=14",
      "UPDATE railway_migrations SET name='0015_unrelated.sql' WHERE position=14",
      "UPDATE railway_migrations SET position=15 WHERE position=14",
      "UPDATE railway_migrations SET sha256='changed' WHERE position=5",
      "INSERT INTO railway_migrations(name,position,sha256,applied_at) VALUES('0016_other.sql',15,'unexpected',1)",
    ]) {
      db.connection.exec(tamper);
      assert.throws(()=>db.migrate(base),/migration_hash_drift/);
      db.connection.exec("DELETE FROM railway_migrations");
      const restore=db.connection.prepare("INSERT INTO railway_migrations(name,position,sha256,applied_at) VALUES(?,?,?,?)");
      for(const row of expected)restore.run(row.name,row.position,row.sha256,row.applied_at);
    }
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});
