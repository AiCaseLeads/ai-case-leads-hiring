import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {SQLiteD1Database} from "../../lib/railway/sqlite";
import {HubStore} from "../../lib/hub/store";
import {applicationInput,jobInput,SESSION_HASH} from "../hub/fixtures";

// This is a test fixture, never a runtime migration.
const collectionsSql=String.raw`CREATE TABLE hub_collections (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('view','list')),
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('personal','team')),
  query TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  last_mutation TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX hub_collections_owner_visibility ON hub_collections(owner,visibility);
--> statement-breakpoint
CREATE TABLE hub_collection_members (
  collection_id TEXT NOT NULL REFERENCES hub_collections(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES hub_applications(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(collection_id,application_id)
);
--> statement-breakpoint
CREATE INDEX hub_collection_member_application ON hub_collection_members(application_id,collection_id);
--> statement-breakpoint
CREATE TABLE hub_collection_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  collection_id TEXT NOT NULL REFERENCES hub_collections(id) ON DELETE CASCADE,
  requester TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  prompt TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX hub_collection_reviews_reviewer ON hub_collection_reviews(reviewer,created_at);
--> statement-breakpoint
CREATE INDEX hub_collection_reviews_requester ON hub_collection_reviews(requester,created_at);
--> statement-breakpoint
CREATE TABLE hub_collection_review_items (
  review_id TEXT NOT NULL REFERENCES hub_collection_reviews(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES hub_applications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER,
  PRIMARY KEY(review_id,application_id)
);
`;

test("the response-check image can reopen only the exact next collections migration",async()=>{
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),"hiring-collections-rollback-")));
  const before=path.join(root,"before"),next=path.join(root,"next"),filename=path.join(root,"hiring.sqlite");
  const migrations=path.resolve("drizzle");
  const journal=JSON.parse(readFileSync(path.join(migrations,"meta","_journal.json"),"utf8")) as {entries:{idx:number;tag:string}[]};
  const prefix=journal.entries.slice(0,15);
  assert.equal(prefix[14].tag,"0015_response_checks");
  const tag="0014_hub_collections";
  assert.equal(readFileSync(path.join(migrations,tag+".sql"),"utf8"),collectionsSql,"Published collections SQL must match the previous image’s pinned rollback fixture.");
  let db=new SQLiteD1Database(filename);
  try {
    for(const [folder,entries] of [[before,prefix],[next,[...prefix,{idx:15,tag}]]] as const) {
      mkdirSync(path.join(folder,"meta"),{recursive:true});
      writeFileSync(path.join(folder,"meta","_journal.json"),JSON.stringify({entries}));
      for(const entry of entries)writeFileSync(path.join(folder,entry.tag+".sql"),entry.tag===tag?collectionsSql:readFileSync(path.join(migrations,entry.tag+".sql")));
    }
    db.migrate(before);
    const options={sessionHash:SESSION_HASH,origin:"https://example.invalid"};
    const store=new HubStore(db.asD1(),options);
    const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
    db.migrate(next);
    db.connection.prepare("INSERT INTO hub_collections(id,kind,name,owner,visibility,last_mutation,updated_at) VALUES('list','list','Fixture','owner@example.invalid','team','fixture',1)").run();
    db.connection.prepare("INSERT INTO hub_collection_members(collection_id,application_id,added_by,added_at,position) VALUES('list',?,'owner@example.invalid',1,0)").run(app.id);
    db.close();db=new SQLiteD1Database(filename);
    const history=()=>db.connection.prepare("SELECT * FROM railway_migrations ORDER BY position").all();
    const snapshot=history();
    db.migrate(before);
    assert.deepEqual(history(),snapshot);
    assert.equal(db.connection.prepare("SELECT application_id FROM hub_collection_members").get()?.application_id,app.id);
    await new HubStore(db.asD1(),options).acceptApplication(applicationInput(job.id));
    for(const tamper of [
      "UPDATE railway_migrations SET name='different.sql' WHERE position=15",
      "UPDATE railway_migrations SET sha256='changed' WHERE position=15",
      "UPDATE railway_migrations SET position=16 WHERE position=15",
      "UPDATE railway_migrations SET sha256='prior-drift' WHERE position=14",
      "INSERT INTO railway_migrations(name,position,sha256,applied_at) VALUES('0017_future.sql',16,'new',1)",
    ]){
      db.connection.exec(tamper);
      assert.throws(()=>db.migrate(before),/migration_hash_drift/);
      db.connection.exec("DELETE FROM railway_migrations");
      const restore=db.connection.prepare("INSERT INTO railway_migrations(name,position,sha256,applied_at) VALUES(?,?,?,?)");
      for(const row of snapshot)restore.run(row.name,row.position,row.sha256,row.applied_at);
    }
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
