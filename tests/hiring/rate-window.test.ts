import test from 'node:test';
import assert from 'node:assert/strict';
import { hourlyRateWindow } from '../../lib/hiring/rate-window';
import { customDatabase } from '../custom-fixture';
import { D1HiringStore } from '../../lib/hiring/store';
import { cleanupExpiredUploads } from '../../lib/hiring/upload-cleanup';
import { postApplication } from '../../lib/hiring/http';
import { sha256 } from '../../lib/hiring/crypto';

test('hourly buckets remain in shared ten-minute units and advance once per hour',()=>{
 const hour = Date.UTC(2026,9,15,2);
 assert.equal(hourlyRateWindow(hour),Math.floor(hour/600000));
 assert.equal(hourlyRateWindow(hour+3599999),hourlyRateWindow(hour));
 assert.equal(hourlyRateWindow(hour+3600000),hourlyRateWindow(hour)+6);
});

test('hourly email and AI limits survive actual upload cleanup while expired limits are removed',async()=>{
 const {database,db}=customDatabase();
 const previous={required:process.env.TURNSTILE_REQUIRED,site:process.env.TURNSTILE_SITE_KEY,secret:process.env.TURNSTILE_SECRET_KEY};
 delete process.env.TURNSTILE_REQUIRED;delete process.env.TURNSTILE_SITE_KEY;delete process.env.TURNSTILE_SECRET_KEY;
 try {
  const store=new D1HiringStore(db);
  let accepted=0;
  const deps={store,applicationsEnabled:true,customSubmit:async()=>{accepted++;return {status:'accepted' as const,receipt:'synthetic'};}};
  const submit=()=>postApplication(new Request('https://jobs.example.com/api/applications',{method:'POST',headers:{origin:'https://jobs.example.com','content-type':'application/json',cookie:`hiring_session=${'a'.repeat(64)}`},body:JSON.stringify({jobPostingId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:'_systemfield_email',value:'Synthetic@example.com'}]})}),deps);
  for(let i=0;i<10;i++)assert.equal((await submit()).status,201);
  const aiKey=await sha256('ai:synthetic-hourly');
  for(let i=0;i<5;i++)assert.equal(await store.takeRateLimit(aiKey,hourlyRateWindow(),5),true);
  database.prepare('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES (?,?,1)').run('expired',Math.floor(Date.now()/600000)-145);
  await cleanupExpiredUploads(db,{delete:async()=>{}} as unknown as R2Bucket);
  assert.equal((await submit()).status,429);
  assert.equal(accepted,10);
  assert.equal(await store.takeRateLimit(aiKey,hourlyRateWindow(),5),false);
  assert.equal(database.prepare('SELECT * FROM hiring_rate_limits WHERE key_hash=?').get('expired'),undefined);
 } finally {
  database.close();
  for(const [key,value] of [['TURNSTILE_REQUIRED',previous.required],['TURNSTILE_SITE_KEY',previous.site],['TURNSTILE_SECRET_KEY',previous.secret]] as const)if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
