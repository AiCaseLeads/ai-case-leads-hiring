import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SQLiteD1Database} from '../../lib/railway/sqlite';
import {D1HiringStore} from '../../lib/hiring/store';
import {postApplication} from '../../lib/hiring/http';
import {sha256} from '../../lib/hiring/crypto';
import {hourlyRateWindow} from '../../lib/hiring/rate-window';

function fixture(){const root=mkdtempSync(path.join(realpathSync(os.tmpdir()),'rate-intent-'));const filename=path.join(root,'rate.sqlite');const db=new SQLiteD1Database(filename);db.migrate(path.resolve('drizzle'));return{root,filename,db,store:new D1HiringStore(db.asD1())};}

test('actual Railway adapter atomically bounds mixed new intents and duplicate retries across restart',async()=>{
 const f=fixture();let db=f.db;
 try{
  const window=hourlyRateWindow(),emailKey=await sha256('application:email:synthetic@example.invalid');
  const intents=await Promise.all(Array.from({length:20},(_,i)=>sha256(`synthetic-intent-${i}`)));
  const requests=Array.from({length:100},(_,i)=>({index:i%20,intent:intents[i%20]}));
  const results=await Promise.all(requests.map(async item=>({...item,allowed:await f.store.takeRateLimit(emailKey,window,10,item.intent)})));
  const admitted=intents.filter((_,index)=>results.find(row=>row.index===index)?.allowed);
  assert.equal(admitted.length,10,'Only ten distinct intents can be admitted');
  for(let index=0;index<20;index++)assert.equal(new Set(results.filter(row=>row.index===index).map(row=>row.allowed)).size,1,'An intent and every concurrent retry share the same admission outcome');
  assert.equal(await db.prepare('SELECT attempts FROM hiring_rate_limits WHERE key_hash=? AND window=?').bind(emailKey,window).first<number>('attempts'),10);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM hiring_rate_limits WHERE key_hash LIKE 'rate-intent:%'").first<number>('n'),10,'Denied intents never get admission markers');
  db.close();db=new SQLiteD1Database(f.filename);db.migrate(path.resolve('drizzle'));const restarted=new D1HiringStore(db.asD1());
  assert.equal(await restarted.takeRateLimit(emailKey,window,10,admitted[0]),true,'Allowed retry remains recoverable after restart');
  const denied=intents.find(intent=>!admitted.includes(intent))!;
  assert.equal(await restarted.takeRateLimit(emailKey,window,10,denied),false,'Denied retry stays denied after restart');
  assert.equal(await db.prepare('SELECT attempts FROM hiring_rate_limits WHERE key_hash=? AND window=?').bind(emailKey,window).first<number>('attempts'),10);
  assert.equal(await restarted.takeRateLimit(emailKey,window+6,10,denied),true,'The next hourly window starts a fresh bounded budget');
 }finally{db.close();rmSync(f.root,{recursive:true,force:true});}
});

test('HTTP intent canonicalization discounts answer order while changed input and sessions consume bounded admissions',async()=>{
 const f=fixture(),saved={required:process.env.TURNSTILE_REQUIRED,site:process.env.TURNSTILE_SITE_KEY,secret:process.env.TURNSTILE_SECRET_KEY};
 delete process.env.TURNSTILE_REQUIRED;delete process.env.TURNSTILE_SITE_KEY;delete process.env.TURNSTILE_SECRET_KEY;
 try{
  const email='intent@example.invalid',session='a'.repeat(64),submissionKey=crypto.randomUUID(),jobPostingId=crypto.randomUUID();
  const base={jobPostingId,submissionKey,formVersion:1,fieldSubmissions:[{path:'_systemfield_email',value:email},{path:'experience',value:7}],utmData:{utm_campaign:'Synthetic',utm_source:'Test'}};
  const deps={store:f.store,applicationsEnabled:true,customSubmit:async()=>({status:'accepted' as const,receipt:'synthetic'})};
  const submit=(body:unknown,cookie=session)=>postApplication(new Request('https://jobs.example.invalid/api/applications',{method:'POST',headers:{origin:'https://jobs.example.invalid','content-type':'application/json',cookie:`hiring_session=${cookie}`},body:JSON.stringify(body)}),deps);
  assert.equal((await submit(base)).status,201);
  const reordered={...base,fieldSubmissions:[...base.fieldSubmissions].reverse(),utmData:{utm_source:'Test',utm_campaign:'Synthetic'}};
  assert.equal((await submit(reordered)).status,201);
  const key=await sha256(`application:email:${email}`),budget=()=>f.db.prepare('SELECT attempts FROM hiring_rate_limits WHERE key_hash=? AND window=?').bind(key,hourlyRateWindow()).first<number>('attempts');
  assert.equal(await budget(),1,'Equivalent answer and UTM object ordering use one admission');
  const variants:[unknown,string?][]=[
   [{...base,fieldSubmissions:[{path:'_systemfield_email',value:email},{path:'experience',value:8}]}],
   [base,'b'.repeat(64)],
   [{...base,formVersion:2}],
   [{...base,utmData:{...base.utmData,utm_campaign:'Changed'}}],
   [{...base,utmData:{...base.utmData,utm_source:'Changed'}}],
   [{...base,jobPostingId:crypto.randomUUID()}],
   [{...base,submissionKey:crypto.randomUUID()}],
   [{...base,fieldSubmissions:[{path:'_systemfield_email',value:email.toUpperCase()},{path:'experience',value:7}]}],
   [{...base,fieldSubmissions:[...base.fieldSubmissions,{path:'portfolio',value:'https://example.invalid/synthetic'}]}],
  ];
  for(const [body,cookie] of variants)assert.equal((await submit(body,cookie)).status,201);
  assert.equal(await budget(),10);
  const denied={...base,submissionKey:crypto.randomUUID()};assert.equal((await submit(denied,'c'.repeat(64))).status,429);assert.equal((await submit(denied,'c'.repeat(64))).status,429);
  assert.equal((await submit(reordered)).status,201,'An admitted exact retry remains allowed after quota exhaustion');
  assert.equal(await budget(),10);
  const keys=await f.db.prepare('SELECT key_hash FROM hiring_rate_limits').all<{key_hash:string}>();
  assert.ok(keys.results.every(row=>!row.key_hash.includes(email)&&!row.key_hash.includes(session)&&!row.key_hash.includes(submissionKey)),'Admission rows store hashes, never raw identity or session data');
 }finally{
  f.db.close();rmSync(f.root,{recursive:true,force:true});
  for(const [key,value] of [['TURNSTILE_REQUIRED',saved.required],['TURNSTILE_SITE_KEY',saved.site],['TURNSTILE_SECRET_KEY',saved.secret]] as const)if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
