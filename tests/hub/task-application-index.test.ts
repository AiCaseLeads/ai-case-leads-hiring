import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createStore} from './fixtures';
// Exercise the exact production reconciliation statement, not a simplified lookup.
const source=readFileSync(new URL('../../lib/task-runner.ts',import.meta.url),'utf8');
const query=source.match(/db\.prepare\("(SELECT a\.id,a\.revision FROM hub_applications a WHERE NOT EXISTS[^"\n]+)"\)/)![1];
test('archive reconciliation uses the application-scoped task index',()=>{
 const {database}=createStore();try{
  const plan=database.prepare('EXPLAIN QUERY PLAN '+query).all().map(row=>String(row.detail)).join('\n');
  assert.match(plan,/SEARCH t USING INDEX hub_task_application_idx \(application_id=\? AND kind=\?\)/);
  assert.doesNotMatch(plan,/SCAN t\b|MULTI-INDEX OR/);
 }finally{database.close();}
});
test('indexed reconciliation preserves exact results across many completed and pending tasks',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec("CREATE TABLE hub_applications(id TEXT PRIMARY KEY,revision INTEGER,updated_at INTEGER);CREATE TABLE hub_tasks(id TEXT PRIMARY KEY,application_id TEXT,kind TEXT,status TEXT,result_json TEXT);CREATE INDEX hub_task_pending_idx ON hub_tasks(status);");
  db.exec('BEGIN');const a=db.prepare('INSERT INTO hub_applications VALUES(?,?,?)'),t=db.prepare('INSERT INTO hub_tasks VALUES(?,?,?,?,?)');
  for(let i=0;i<1000;i++){a.run('a'+i,i%10===0?2:1,i);for(let j=0;j<10;j++)t.run('t'+i+'-'+j,'a'+i,'drive',i%20===0?'pending':'done','{"archivedRevision":1}');}
  db.exec('COMMIT');const before=db.prepare(query).all();
  db.exec(readFileSync(new URL('../../drizzle/0011_task_application_index.sql',import.meta.url),'utf8'));
  assert.deepEqual(db.prepare(query).all(),before);assert.equal(before.length,50);
 }finally{db.close();}
});
