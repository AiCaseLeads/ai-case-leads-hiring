import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {syncConnectedHiringReplies} from '../../lib/personal-mail/reply-sync';
import type {GoogleWorkspace} from '../../lib/google/workspace';

test('reply scheduler fairly visits only sent hiring mailboxes, bounds work and isolates failed/disconnected accounts',async()=>{
 const{store,database,db}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 for(const [i,account]of ['a@example.invalid','b@example.invalid','c@example.invalid','d@example.invalid','e@example.invalid'].entries()){
 const id=`mail-${i}`;database.prepare("INSERT INTO hub_tasks(id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) VALUES(?,?,'gmail',?,'done',0,0,0,0)").run(id,app.id,JSON.stringify({deliveryAccount:account,deliveryProvider:'gmail'}));database.prepare("INSERT INTO hub_communications(id,application_id,task_id,subject,body,status,thread_id,created_at,updated_at) VALUES(?,?,?,'s','b','sent',?,0,0)").run(id,app.id,id,`thread-${i}`);
 }
 const resolved:string[]=[],synced:string[]=[];
 const resolve=async(account:string)=>{resolved.push(account);if(account.startsWith('a'))throw Error('Disconnected');if(account.startsWith('b'))return null;return {account,profile:async()=>({email:account}),setDeadline:(value:number)=>assert.ok(value<=Date.now()+8000)} as unknown as GoogleWorkspace;};
 const sync=async(_store:unknown,_db:unknown,workspace:GoogleWorkspace,max=25)=>{assert.equal(max,25);synced.push((workspace as unknown as {account:string}).account);return 1;};
 assert.equal(await syncConnectedHiringReplies(store,db,undefined,Date.now()+30000,resolve,sync),1);assert.deepEqual(resolved,['a@example.invalid','b@example.invalid','c@example.invalid']);
 assert.equal(await syncConnectedHiringReplies(store,db,undefined,Date.now()+30000,resolve,sync),2);assert.deepEqual(resolved.slice(3),['d@example.invalid','e@example.invalid','a@example.invalid']);assert.deepEqual(synced,['c@example.invalid','d@example.invalid','e@example.invalid']);
 const before=resolved.length;await store.setSetting('personal_mail_sync_scheduler_lease_v1',{token:'other',until:Date.now()+30000});assert.equal(await syncConnectedHiringReplies(store,db,undefined,Date.now()+30000,resolve,sync),0);assert.equal(resolved.length,before);
 }finally{database.close();}
});
