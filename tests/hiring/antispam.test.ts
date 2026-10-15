import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyChallenge, requireGrant, spamStatus } from '../../lib/hiring/antispam';
const config={siteKey:'site',secret:'test-secret',hostname:'jobs.example.com'};
const success = () => Response.json({success:true,hostname:config.hostname,action:'application',challenge_ts:new Date().toISOString()});
const fetcher=(async()=>success()) as typeof fetch;
test('valid challenge binds grant to session, job, submission and expires',async()=>{
 const {grant}=await verifyChallenge('token','session','submission','job',config.hostname,config,fetcher);
 await requireGrant(grant,'session','submission','job',config);
 for(const args of [['other','submission','job'],['session','other','job'],['session','submission','other']]) await assert.rejects(requireGrant(grant,...args as [string,string,string],config));
 await assert.rejects(requireGrant(grant.replace(/^\d+/, '1'),'session','submission','job',config));
 await assert.rejects(requireGrant(null,'session','submission','job',config));
});
test('rejects missing, invalid, replayed, expired, wrong host/action challenges',async()=>{
 for(const result of [{success:false},{success:true,hostname:'evil.test',action:'application'},{success:true,hostname:config.hostname,action:'login'},{success:true,hostname:config.hostname,action:'application',challenge_ts:new Date(Date.now()-301000).toISOString()}]) await assert.rejects(verifyChallenge('token','s','k','j',config.hostname,config,(async()=>Response.json(result)) as typeof fetch));
 await assert.rejects(verifyChallenge('', 's','k','j',config.hostname,config,fetcher));
 let used=false;
 const once=(async()=>{if(used)return Response.json({success:false,'error-codes':['timeout-or-duplicate']});used=true;return success();}) as typeof fetch;
 assert.equal((await Promise.allSettled([verifyChallenge('same','s','k','j',config.hostname,config,once),verifyChallenge('same','s','k','j',config.hostname,config,once)])).filter(r=>r.status==='fulfilled').length,1);
});
test('partial setup and service failures fail closed; unconfigured status is explicit',async()=>{
 assert.deepEqual(spamStatus({}),{required:false,configured:false,siteKey:null});
 await assert.rejects(requireGrant(null,'s','k','j',{required:true}));
 await assert.rejects(requireGrant(null,'s','k','j',{siteKey:'site'}));
 await assert.rejects(verifyChallenge('t','s','k','j',config.hostname,config,(async()=>{throw Error('offline');}) as typeof fetch));
});

test('HTTP endpoints reject bypass, preserve recorded submission recovery and enforce shared limits',async()=>{
 const {postApplication,postUpload}=await import('../../lib/hiring/http');
 const {sha256}=await import('../../lib/hiring/crypto');
 const previous=process.env.TURNSTILE_REQUIRED;
 process.env.TURNSTILE_REQUIRED='true';
 const session='a'.repeat(64), key='12345678-1234-4234-8234-123456789012';
 let existing: unknown=null, calls=0;
 const buckets=new Map<string,number>();
 const store={find:async()=>existing,takeRateLimit:async(key:string,_window:number,limit:number)=>{const count=(buckets.get(key)||0)+1;buckets.set(key,count);return count<=limit;}};
 const deps={store,applicationsEnabled:true,customSubmit:async()=>{calls++;return {status:'accepted',receipt:'test'};}} as unknown as import('../../lib/hiring/http').HiringDependencies;
 const request=(body:unknown)=>new Request('https://jobs.example.com/api/applications',{method:'POST',headers:{origin:'https://jobs.example.com','content-type':'application/json',cookie:`hiring_session=${session}`,'cf-connecting-ip':'1.2.3.4'},body:JSON.stringify(body)});
 const application={jobPostingId:key,submissionKey:key,fieldSubmissions:[{path:'email',value:'fake@example.com'}]};
 try {
  assert.equal((await postApplication(request(application),deps)).status,503);
  assert.equal((await postUpload(request({jobPostingId:key,fieldPath:'resume',filename:'resume.pdf',contentType:'application/pdf',contentLength:100}),deps)).status,503);
  assert.equal(calls,0);
  existing={sessionHash:await sha256(session)};
  assert.equal((await postApplication(request(application),deps)).status,201);
  assert.equal(calls,1);
  existing=null;
  const responses=await Promise.all(Array.from({length:40},()=>postApplication(request(application),deps)));
  assert.ok(responses.some(response=>response.status===429));
  assert.equal(calls,1);
 } finally {if(previous===undefined)delete process.env.TURNSTILE_REQUIRED;else process.env.TURNSTILE_REQUIRED=previous;}
});
