import test from 'node:test';
import assert from 'node:assert/strict';
import {hubRequest,HubError,retainHubResource} from '../../components/hub/api';
test('same-resource drafts survive transient revalidation while changed paths and permission failures clear stale data',()=>{
 for(const status of [0,200,401,500,502,503,504])assert.equal(retainHubResource(new HubError('Retry',status),'/record/a','/record/a'),true);
 assert.equal(retainHubResource(new HubError('Sign in',403,'staff_access_required'),'/record/a','/record/a'),true);
 for(const status of [400,403,404])assert.equal(retainHubResource(new HubError('Denied',status),'/record/a','/record/a'),false);
 assert.equal(retainHubResource(new HubError('Retry',503),'/record/a','/record/b'),false);
 assert.equal(retainHubResource(new HubError('Retry',503),null,'/record/a'),false);
});
test('staff-session rejection emits one typed recovery event without treating ordinary permissions as sign-out',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 const events=new EventTarget();let expired=0;events.addEventListener('hub:session-expired',()=>expired++);
 Object.defineProperty(globalThis,'window',{value:events,configurable:true});
 try{
  globalThis.fetch=async()=>Response.json({error:{code:'staff_access_required',message:'Sign in.'}},{status:403});
  await assert.rejects(hubRequest('/api/hub/overview'),(e:unknown)=>e instanceof HubError&&e.status===403&&e.code==='staff_access_required');assert.equal(expired,1);
  globalThis.fetch=async()=>Response.json({error:{code:'owner_access_required',message:'Owner only.'}},{status:403});
  await assert.rejects(hubRequest('/api/agent-access'),{code:'owner_access_required'});assert.equal(expired,1);
  globalThis.fetch=async()=>Response.json({data:{email:'reviewer@example.invalid'}});
  assert.deepEqual(await hubRequest('/api/hub-session'),{email:'reviewer@example.invalid'});assert.equal(expired,1);
 }finally{globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'window',{value:originalWindow,configurable:true})}
});
