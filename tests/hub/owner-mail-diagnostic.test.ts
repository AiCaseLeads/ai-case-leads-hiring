import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './fixtures';
import {sendOwnerMailTest} from '../../lib/personal-mail/diagnostic';
import {mailGrantKey} from '../../lib/personal-mail/service';
import {configurationFingerprint} from '../../lib/google/config-state';
import {sealToken} from '../../lib/google/oauth';
import {GoogleError} from '../../lib/google/http';

const owner='sales@aicaseleads.com',key='c'.repeat(64),testId='self-test-001',messageId=`qa-owner-test-${testId}@jobs.aicaseleads.com`;
const env={GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_TOKEN_KEY:key,GOOGLE_CLIENT_REVISION:0,ADMIN_EMAILS:owner};
async function grant(store:ReturnType<typeof createStore>['store']){await store.setSetting(mailGrantKey(owner),{email:owner,sealedToken:await sealToken('private-diagnostic-refresh',key),revision:0,fingerprint:await configurationFingerprint(env),connectedAt:Date.now()});}
function provider(account=owner,uncertain=false){
 let sent=false,sends=0,requests=0;const fetcher:typeof fetch=async(input,init={})=>{
  requests++;const url=new URL(String(input));
  if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'private-access',token_type:'Bearer',expires_in:3600});
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:account});
  if(url.pathname.endsWith('/messages')){assert.equal(url.searchParams.get('q'),`in:sent rfc822msgid:<${messageId}>`);return Response.json({messages:sent?[{id:'diagnostic-sent',threadId:'diagnostic-thread'}]:[]});}
  if(url.pathname.endsWith('/messages/diagnostic-sent'))return Response.json({id:'diagnostic-sent',threadId:'diagnostic-thread',labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:`<${messageId}>`}]}});
  if(url.pathname.endsWith('/messages/send')){
   sends++;
   const mime=Buffer.from(JSON.parse(String(init.body)).raw,'base64url').toString('utf8');
   assert.match(mime,/From: sales@aicaseleads.com\r\n/);assert.match(mime,/To: sales@aicaseleads.com\r\n/);assert.match(mime,/Reply-To: sales@aicaseleads.com\r\n/);assert.match(mime,new RegExp(`Message-ID: <${messageId}>`));
   const addresses=mime.match(/[a-z0-9-]+@[a-z0-9.-]+/gi)||[];assert.ok(addresses.every(value=>value===owner||value===messageId));
   const body=Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString('utf8');assert.match(body,/No applicant was contacted/);assert.ok(!body.includes('https://'));
   const encoded=mime.match(/Subject: =\?UTF-8\?B\?([^?]+)/)![1];assert.match(Buffer.from(encoded,'base64').toString('utf8'),/^Hiring email connection test – /);
   if(uncertain)throw new Error('private provider failure');
   sent=true;return Response.json({id:'diagnostic-sent',threadId:'diagnostic-thread'});
  }
  throw new Error('unexpected_test_request');
 };return {fetcher,counts:()=>({sends,requests})};
}
test('operator diagnostic sends only to the owner and reconciles its deterministic message without resending',async()=>{
 const f=createStore(),google=provider();try{
  await grant(f.store);const before=f.database.prepare('SELECT count(*) n FROM hub_applications').get()!.n;
  const first=await sendOwnerMailTest(f.store,' SALES@AICASELEADS.COM ',testId,env,google.fetcher);
  assert.deepEqual(first,{recipient:owner,messageId,sentMessageId:'diagnostic-sent',threadId:'diagnostic-thread'});
  assert.deepEqual(await sendOwnerMailTest(f.store,owner,testId,env,google.fetcher),first);assert.equal(google.counts().sends,1);
  assert.equal(f.database.prepare('SELECT count(*) n FROM hub_applications').get()!.n,before);assert.doesNotMatch(JSON.stringify(first),/private-|refresh|sealedToken/);
 }finally{f.database.close();}
});
test('diagnostic rejects nonowners, unsafe test IDs and missing personal grants before sending',async()=>{
 const f=createStore(),google=provider();try{
  await assert.rejects(()=>sendOwnerMailTest(f.store,'candidate@example.invalid',testId,env,google.fetcher),{code:'owner_mail_test_not_allowed'});
  await assert.rejects(()=>sendOwnerMailTest(f.store,owner,'bad\r\nBcc: other@example.invalid',env,google.fetcher),{code:'invalid_owner_mail_test_id'});
  await assert.rejects(()=>sendOwnerMailTest(f.store,owner,testId,env,google.fetcher),{code:'owner_mail_connection_required'});
  assert.equal(google.counts().requests,0);
 }finally{f.database.close();}
});
test('diagnostic refuses a mismatched Google profile and propagates uncertain sends without retry',async()=>{
 const f=createStore();try{
  await grant(f.store);const wrong=provider('other@example.invalid');
  await assert.rejects(()=>sendOwnerMailTest(f.store,owner,testId,env,wrong.fetcher),{code:'owner_mail_identity_mismatch'});assert.equal(wrong.counts().sends,0);
  const uncertain=provider(owner,true);
  await assert.rejects(()=>sendOwnerMailTest(f.store,owner,testId,env,uncertain.fetcher),error=>error instanceof GoogleError&&error.uncertain);
  assert.equal(uncertain.counts().sends,1);
 }finally{f.database.close();}
});
