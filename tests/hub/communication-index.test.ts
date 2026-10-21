import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './fixtures';
test('application detail communication lookup uses its scoped ordered index',()=>{
 const {database}=createStore();try{
 const plan=database.prepare('EXPLAIN QUERY PLAN SELECT c.*,t.payload_json FROM hub_communications c LEFT JOIN hub_tasks t ON t.id=c.task_id WHERE c.application_id=? ORDER BY c.created_at DESC,c.id').all('synthetic-application').map(row=>String(row.detail)).join('\n');
 assert.match(plan,/SEARCH c USING INDEX hub_communication_app_idx \(application_id=\?\)/);
 assert.doesNotMatch(plan,/SCAN c\b|TEMP B-TREE/);
 }finally{database.close();}
});
