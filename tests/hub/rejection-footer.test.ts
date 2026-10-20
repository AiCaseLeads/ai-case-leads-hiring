import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './fixtures';
import {candidateMail} from '../../lib/job-team/service';
import {isRejectionTask} from '../../lib/google/mail-setup';
import {AUTOMATED_MAIL_NOTICE} from '../../lib/hiring/receipt-email';
test('all rejection task identities get a short no-reply footer, including previously appended notices',async()=>{
 const {store,database}=createStore();try{
 for(const taskId of ['gmail:app:rejection','gmail:app:rejection:2']){
  assert.equal(isRejectionTask(taskId,'app'),true);
  for(const body of ['Thank you for applying.',`Thank you for applying.\n\n${AUTOMATED_MAIL_NOTICE}`]){
   const mail=await candidateMail(store,{to:'candidate@example.invalid',subject:'Outcome',body,messageId:'synthetic'},[],{applicationId:'app',rejection:isRejectionTask(taskId,'app')});
   assert.match(mail.body,/Please do not reply/);assert.doesNotMatch(mail.body,/privacy|\/help/);assert.equal(mail.replyTo?.[0],'no-reply@notify.aicaseleads.com');
  }
 }
 }finally{database.close();}
});
test('receipts and custom template links stay unchanged; task classification is application scoped',async()=>{
 const {store,database}=createStore();try{
 assert.equal(isRejectionTask('gmail:other:rejection','app'),false);assert.equal(isRejectionTask('gmail:app:confirmation','app'),false);assert.equal(isRejectionTask('gmail:app:manual:rejection','app'),false);
 const input={to:'candidate@example.invalid',subject:'Rejection words in an editable subject',body:'Thank you.',messageId:'synthetic'};
 assert.ok((await candidateMail(store,input,[],{applicationId:'app'})).body.includes(AUTOMATED_MAIL_NOTICE));
 const custom='Read our own policy: https://example.invalid/privacy';
 assert.ok((await candidateMail(store,{...input,body:custom},[],{applicationId:'app',rejection:true})).body.includes(custom));
 }finally{database.close();}
});
