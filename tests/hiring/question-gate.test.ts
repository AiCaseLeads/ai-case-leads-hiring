import test from 'node:test';
import assert from 'node:assert/strict';
import {getJob,postJobForm} from '../../lib/hiring/http';
import {verifyChallenge} from '../../lib/hiring/antispam';
import {FixtureProvider,SESSION,JOB_ID,sqliteStore} from './fixtures';

test('public role hides questions; only the verified session and job can load them',async t=>{
 const keys=['TURNSTILE_REQUIRED','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','PUBLIC_ORIGIN'] as const;
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 process.env.TURNSTILE_REQUIRED='true';process.env.TURNSTILE_SITE_KEY='synthetic';process.env.TURNSTILE_SECRET_KEY='synthetic-secret';process.env.PUBLIC_ORIGIN='https://jobs.example.invalid';
 t.after(()=>{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]});
 const {database,store}=sqliteStore();t.after(()=>database.close());const provider=new FixtureProvider();const job=provider.jobs[0];const deps={provider,store,applicationsEnabled:true};
 const detail=await getJob(new Request(`https://jobs.example.invalid/api/jobs/${job.slug}`),job.slug,deps);const publicData=await detail.json() as Record<string,unknown>;assert.equal('fields' in publicData,false);assert.equal('formVersion' in publicData,false);assert.ok(publicData.job);
 const key='12345678-1234-4234-8234-123456789012';
 const request=(grant:string,session=SESSION,submissionKey=key)=>new Request(`https://jobs.example.invalid/api/jobs/${job.slug}/form`,{method:'POST',headers:{origin:'https://jobs.example.invalid','content-type':'application/json',cookie:`hiring_session=${session}`},body:JSON.stringify({grant,submissionKey})});
 assert.equal((await postJobForm(request(''),job.slug,deps)).status,403);
 const grant=await verifyChallenge('token',SESSION,key,JOB_ID,'jobs.example.invalid',{siteKey:'synthetic',secret:'synthetic-secret',hostname:'jobs.example.invalid'},async()=>Response.json({success:true,hostname:'jobs.example.invalid',action:'application',challenge_ts:new Date().toISOString()}));
 const paused=await postJobForm(request(grant.grant),job.slug,{...deps,applicationsEnabled:false});assert.equal(paused.status,503);
 delete process.env.TURNSTILE_REQUIRED;delete process.env.TURNSTILE_SITE_KEY;delete process.env.TURNSTILE_SECRET_KEY;assert.equal((await postJobForm(request(grant.grant),job.slug,deps)).status,503);
 process.env.TURNSTILE_REQUIRED='true';process.env.TURNSTILE_SITE_KEY='synthetic';process.env.TURNSTILE_SECRET_KEY='synthetic-secret';
 const result=await postJobForm(request(grant.grant),job.slug,deps);assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.ok(Array.isArray(((await result.json()) as {fields?:unknown}).fields));
 assert.equal((await postJobForm(request(grant.grant,'b'.repeat(64)),job.slug,deps)).status,403);
 assert.equal((await postJobForm(request(grant.grant,SESSION,'different-submission-key-123'),job.slug,deps)).status,403);
 const originalInfo=provider.jobInfo.bind(provider);provider.jobInfo=async()=>({...await originalInfo(),formVersion:2});assert.equal(((await (await postJobForm(request(grant.grant),job.slug,deps)).json()) as {formVersion:number}).formVersion,2);
 provider.jobInfo=async()=>({...await originalInfo(),formUnavailable:'Synthetic unsupported form'});assert.equal((await postJobForm(request(grant.grant),job.slug,deps)).status,503);provider.jobInfo=originalInfo;
 provider.jobs=[{...job,id:'different-job'}];assert.equal((await postJobForm(request(grant.grant),job.slug,deps)).status,403);
 provider.jobs=[];assert.equal((await postJobForm(request(grant.grant),job.slug,deps)).status,404);
});
