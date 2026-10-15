import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './fixtures';
import {helpInput,saveHelp,listHelp,resolveHelp} from '../../lib/recruiting-help/service';
const input=()=>({id:crypto.randomUUID(),email:'Applicant@example.com',job:'Engineer',kind:'privacy' as const,message:'Please correct my application information.',token:''});
test('help requests are durable, idempotent, private records and never create email tasks',async()=>{
 const f=createStore();try{
  const data=input();await saveHelp(f.store,data,'session');await saveHelp(f.store,data,'session');
  let items=(await listHelp(f.store)).items;assert.equal(items.length,1);assert.equal(items[0].email,'applicant@example.com');assert.equal(items[0].status,'open');
  assert.equal((await f.store.tasks()).length,0);assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM hub_applications').get()?.n,0);
  await resolveHelp(f.store,items[0].key,'resolved','recruiter@example.com');items=(await listHelp(f.store)).items;assert.equal(items[0].status,'resolved');assert.equal(items[0].resolvedBy,'recruiter@example.com');
  await resolveHelp(f.store,items[0].key,'open','recruiter@example.com');assert.equal((await listHelp(f.store)).items[0].status,'open');
  await assert.rejects(()=>resolveHelp(f.store,'google_refresh_token','resolved','recruiter@example.com'));
 }finally{f.database.close();}
});
test('help email/session limits reject abuse without losing accepted requests',async()=>{
 const f=createStore();try{
  for(let i=0;i<5;i++)await saveHelp(f.store,input(),'same-session');
  await assert.rejects(()=>saveHelp(f.store,input(),'same-session'),{code:'rate_limited'});
  assert.equal((await listHelp(f.store)).items.length,5);
  await assert.rejects(()=>saveHelp(f.store,input(),'fresh-session'),{code:'rate_limited'});
 }finally{f.database.close();}
});
test('help queue pages at 25 records and bounds fields without accepting unknown properties',async()=>{
 const f=createStore();try{
  for(let i=0;i<27;i++)await saveHelp(f.store,{...input(),email:`applicant${i}@example.com`},`session${i}`);
  const first=await listHelp(f.store),second=await listHelp(f.store,2);assert.equal(first.items.length,25);assert.equal(first.hasMore,true);assert.equal(second.items.length,2);assert.equal(second.hasMore,false);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,27);
  assert.equal(helpInput.safeParse({...input(),message:'x'.repeat(4001)}).success,false);assert.equal(helpInput.safeParse({...input(),to:'sales@example.com'}).success,false);
 }finally{f.database.close();}
});

test('help verification attempts are bounded before provider calls and changed retries conflict',async()=>{
 const {limitHelpVerification,existingHelp}=await import('../../lib/recruiting-help/service');const f=createStore();try{
  for(let i=0;i<20;i++)await limitHelpVerification(f.store,'same-session');
  await assert.rejects(()=>limitHelpVerification(f.store,'same-session'),{code:'rate_limited'});
  const data=input();await saveHelp(f.store,data,'same-session');assert.equal(await existingHelp(f.store,data,'same-session'),true);
  await assert.rejects(()=>existingHelp(f.store,{...data,message:'Different requested action here.'},'same-session'),{code:'request_conflict'});
  assert.equal(await existingHelp(f.store,data,'different-session'),false);
 }finally{f.database.close();}
});
test('only resolved help requests older than 90 days are removed; applications and open requests remain',async()=>{
 const f=createStore();try{
  await saveHelp(f.store,input(),'session');await saveHelp(f.store,input(),'session');
  const items=(await listHelp(f.store)).items;await resolveHelp(f.store,items[0].key,'resolved','staff@example.com');
  f.database.prepare('UPDATE hub_recruiting_help SET updated_at=?').run(Date.now()-91*86400000);
  const remaining=await listHelp(f.store);assert.equal(remaining.items.length,1);assert.equal(remaining.items[0].status,'open');
 }finally{f.database.close();}
});
