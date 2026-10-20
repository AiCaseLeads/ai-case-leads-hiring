import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {sha256} from '../../lib/hiring/crypto';
import {sendShareInvitations} from '../../lib/hub/share-invitations';
import type {AutomaticMailResolver} from '../../lib/email/service';

test('share invitations use only stored recipients and deduplicate accepted or uncertain sends',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  const token='a'.repeat(64),hash=await sha256(token);const emails=['reviewer@example.test','second@example.test'];
  await store.setSetting('applicant_share:'+app.id,{applicationId:app.id,hash,access:'people',emails,expiresAt:Date.now()+60000});
  const sends:Array<{to:string;body:string}>=[];
  const resolve:AutomaticMailResolver=async()=>({fingerprint:'test',verify:async()=>{},reconcileMail:async()=>null,sendMail:async mail=>{sends.push(mail);if(mail.to===emails[1])throw Error('uncertain');return {accepted:true};}});
  assert.deepEqual(await sendShareInvitations(store,app.id,token,'https://jobs.example.test',resolve),{sent:1,alreadySent:0,failed:0,uncertain:1});
  assert.deepEqual(sends.map(mail=>mail.to),emails);assert.match(sends[0].body,/Verify this email/);assert.match(sends[0].body,/https:\/\/jobs.example.test\/shared-applicants\//);
  assert.deepEqual(await sendShareInvitations(store,app.id,token,'https://jobs.example.test',resolve),{sent:0,alreadySent:1,failed:0,uncertain:1});assert.equal(sends.length,2);
  await assert.rejects(sendShareInvitations(store,app.id,'b'.repeat(64),'https://jobs.example.test',resolve),{code:'share_unavailable'});
  await store.setSetting('application_trash:'+app.id,{deletedAt:Date.now()});
  await assert.rejects(sendShareInvitations(store,app.id,token,'https://jobs.example.test',resolve),{code:'share_unavailable'});
 }finally{database.close();}
});
