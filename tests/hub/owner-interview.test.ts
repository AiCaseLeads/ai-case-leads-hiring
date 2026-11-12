import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {DEFAULT_INTERVIEW,interviewMessage} from '../../lib/hub/interview-template';
import {interviewReadiness} from '../../lib/hub/interview-readiness';
import {sendInterviewInvitation} from '../../lib/hub/interview-delivery';
import {submitInterviewInvitation} from '../../lib/hub/interview-submit';
import {mailGrantKey,personalMailWorkspace} from '../../lib/personal-mail/service';
import {grantKey,availabilityKey,defaultAvailability} from '../../lib/personal-calendar/service';
import {configurationFingerprint} from '../../lib/google/config-state';
import {sealToken} from '../../lib/google/oauth';
import {processHubTasks} from '../../lib/task-runner';
import {emptyJobTeam,validateTeam,candidateMail} from '../../lib/job-team/service';
import {sha256} from '../../lib/hiring/crypto';
import {previewMailRecovery} from '../../lib/hub/mail-recovery';
import {automaticFixture} from './automatic-fixture';

const owner={...MANAGER,email:'sales@aicaseleads.com'};
const env={GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_TOKEN_KEY:'b'.repeat(64),GOOGLE_CLIENT_REVISION:0,ADMIN_EMAILS:owner.email};
test('owner without a member row previews and sends a valid booking link using their own OAuth Gmail, CC and Reply-To',async(t)=>{
 const previous=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner.email;t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous;});
 const f=createStore();try{
  const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id)),fingerprint=await configurationFingerprint(env);
  assert.equal(await f.store.stmt('SELECT 1 FROM hub_members WHERE email=?',owner.email).first(),null);
  await f.store.setSetting(grantKey(owner.email),{email:owner.email,calendarId:owner.email,sealedToken:'calendar-separate',revision:0,fingerprint,connectedAt:1});
  await f.store.setSetting(availabilityKey(owner.email),defaultAvailability);
  const input={action:'interview' as const,...DEFAULT_INTERVIEW,templateVersion:1,interviewerEmail:owner.email,expectedRevision:(await f.store.applicationRow(app.id)).revision};
  const missing=await interviewReadiness(f.store,owner,app.id,env);assert.equal(missing.sender,owner.email);assert.equal(missing.mailIssue,'recruiter_email_not_connected');assert.equal(missing.interviewers.find(person=>person.email===owner.email)?.ready,true);
  const preview=await interviewMessage(f.store,owner,app.id,input);
  await assert.rejects(()=>submitInterviewInvitation(f.store,owner,app.id,{...input,previewFingerprint:preview.fingerprint},env),{code:'interview_email_setup_required'});
  assert.equal((await f.store.getApplication(app.id)).interviews.length,0);
  await f.store.setSetting(mailGrantKey(owner.email),{email:owner.email,sealedToken:await sealToken('synthetic-owner-refresh',env.GOOGLE_TOKEN_KEY),revision:0,fingerprint,connectedAt:1});
  const ready=await interviewReadiness(f.store,owner,app.id,env);assert.equal(ready.mailReady,true);assert.deepEqual(ready.cc,[owner.email]);assert.deepEqual(ready.replyTo,[owner.email]);
  f.database.prepare("UPDATE hub_tasks SET status='done'").run();
  const approved=await interviewMessage(f.store,owner,app.id,input);
  let sent=0,mime='';
  const provider:typeof fetch=async(url,init={})=>{
   const target=new URL(String(url));
   if(target.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600});
   if(target.pathname.endsWith('/profile'))return Response.json({emailAddress:owner.email,historyId:'1'});
   if(target.pathname.endsWith('/messages/send')){sent++;mime=Buffer.from(JSON.parse(String(init.body)).raw,'base64url').toString();return Response.json({id:'owner-sent',threadId:'owner-thread'});}
   if(target.pathname.endsWith('/messages'))return Response.json({messages:[]});
   if(target.pathname.includes('/threads/'))return Response.json({messages:[]});
   if(target.pathname.endsWith('/history'))return Response.json({historyId:'1',history:[]});
   throw new Error('Unexpected synthetic provider request');
  };
  const resolve=async(account:string)=>{assert.equal(account,owner.email);return personalMailWorkspace(f.store,account,env,provider);};
  const response=await sendInterviewInvitation(f.store,owner,app.id,{...input,previewFingerprint:approved.fingerprint,internalNote:'Private owner interview note.'},env,resolve);
  assert.deepEqual(response.interviewDelivery,{status:"sent",cc:[owner.email]});
  const task=(await f.store.tasks()).find(item=>item.id.includes(':interview:'))!;
  const token=String(task.payload.body).match(/\/interview\/([a-f0-9]{64})/)![1];
  const link=await f.store.stmt("SELECT application_id,expires_at FROM hub_links WHERE token_hash=? AND kind='interview'",await sha256(token)).first<{application_id:string;expires_at:number}>();
  assert.equal(link?.application_id,app.id);assert.ok(link!.expires_at>Date.now()+13*86400000);
  assert.equal(sent,1);assert.match(mime,/From: sales@aicaseleads.com\r\n/);assert.match(mime,/Cc: sales@aicaseleads.com\r\n/);assert.match(mime,/Reply-To: sales@aicaseleads.com\r\n/);
  const deliveredBody=Buffer.from(mime.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString();assert.ok(deliveredBody.includes('/interview/'+token));assert.ok(!deliveredBody.includes('Private owner interview note.'));
  const delivery=(await f.store.tasks()).find(item=>item.id===task.id)!;assert.equal(delivery.status,'done');assert.equal(delivery.payload.deliveryAccount,owner.email);
  const communication=(await f.store.getApplication(app.id)).communications.find(item=>item.purpose==='Interview invitation') as unknown as {status:string;cc:string[];replyTo:string[]};assert.equal(communication.status,'sent');assert.deepEqual(communication.cc,[owner.email]);assert.deepEqual(communication.replyTo,[owner.email]);
  await processHubTasks(f.store,f.db,undefined,undefined,3,[owner.email],resolve);assert.equal(sent,1);
 }finally{f.database.close();}
});
test('selected interviewer sends from their own connected mailbox with matching Reply-To and CC',async(t)=>{
 const previous=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner.email;t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous;});
 const f=createStore();try{
  const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id)),fingerprint=await configurationFingerprint(env);
  const interviewer='maria@aicaseleads.com';
  await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",'maria',interviewer,'recruiter').run();
  await f.store.setSetting(grantKey(interviewer),{email:interviewer,calendarId:interviewer,sealedToken:'calendar-maria',revision:0,fingerprint,connectedAt:1});
  await f.store.setSetting(availabilityKey(interviewer),defaultAvailability);
  assert.equal(await f.store.stmt('SELECT 1 FROM hub_members WHERE email=?',owner.email).first(),null);
  await f.store.setSetting(grantKey(owner.email),{email:owner.email,calendarId:owner.email,sealedToken:'calendar-separate',revision:0,fingerprint,connectedAt:1});
  await f.store.setSetting(availabilityKey(owner.email),defaultAvailability);
  const input={action:'interview' as const,...DEFAULT_INTERVIEW,templateVersion:1,interviewerEmail:interviewer,body:DEFAULT_INTERVIEW.body+'\nContact '+interviewer+'.',expectedRevision:(await f.store.applicationRow(app.id)).revision};
  const missing=await interviewReadiness(f.store,owner,app.id,env,input);assert.equal(missing.sender,interviewer);assert.equal(missing.mailIssue,'recruiter_email_not_connected');assert.equal(missing.interviewers.find(person=>person.email===interviewer)?.ready,true);
  const preview=await interviewMessage(f.store,owner,app.id,input);
  await assert.rejects(()=>submitInterviewInvitation(f.store,owner,app.id,{...input,previewFingerprint:preview.fingerprint},env),{code:'interview_email_setup_required'});
  assert.equal((await f.store.getApplication(app.id)).interviews.length,0);
  await f.store.setSetting(mailGrantKey(interviewer),{email:interviewer,sealedToken:await sealToken('synthetic-owner-refresh',env.GOOGLE_TOKEN_KEY),revision:0,fingerprint,connectedAt:1});
  const ready=await interviewReadiness(f.store,owner,app.id,env,input);assert.equal(ready.mailReady,true);assert.deepEqual(ready.cc,[interviewer]);assert.deepEqual(ready.replyTo,[interviewer]);
  f.database.prepare("UPDATE hub_tasks SET status='done'").run();
  const approved=await interviewMessage(f.store,owner,app.id,input);
  await submitInterviewInvitation(f.store,owner,app.id,{...input,previewFingerprint:approved.fingerprint,internalNote:'Private owner interview note.'},env);
  const task=(await f.store.tasks()).find(item=>item.id.includes(':interview:'))!;
  assert.equal(task.payload.interviewerEmail,interviewer);
  assert.deepEqual(task.payload.approvedEnvelope,{sender:interviewer,to:(await f.store.applicationRow(app.id)).email,cc:[interviewer],replyTo:[interviewer]});
  const token=String(task.payload.body).match(/\/interview\/([a-f0-9]{64})/)![1];
  const link=await f.store.stmt("SELECT application_id,expires_at FROM hub_links WHERE token_hash=? AND kind='interview'",await sha256(token)).first<{application_id:string;expires_at:number}>();
  assert.equal(link?.application_id,app.id);assert.ok(link!.expires_at>Date.now()+13*86400000);
  let sent=0,mime='';
  const provider:typeof fetch=async(url,init={})=>{
   const target=new URL(String(url));
   if(target.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600});
   if(target.pathname.endsWith('/profile'))return Response.json({emailAddress:interviewer,historyId:'1'});
   if(target.pathname.endsWith('/messages/send')){sent++;mime=Buffer.from(JSON.parse(String(init.body)).raw,'base64url').toString();return Response.json({id:'owner-sent',threadId:'owner-thread'});}
   if(target.pathname.endsWith('/messages'))return Response.json({messages:[]});
   if(target.pathname.includes('/threads/'))return Response.json({messages:[]});
   if(target.pathname.endsWith('/history'))return Response.json({historyId:'1',history:[]});
   throw new Error('Unexpected synthetic provider request');
  };
  const resolve=async(account:string)=>{assert.equal(account,interviewer);return personalMailWorkspace(f.store,account,env,provider);};
  await processHubTasks(f.store,f.db,undefined,undefined,3,[owner.email],resolve);
  assert.equal(sent,1);assert.match(mime,/From: maria@aicaseleads.com\r\n/);assert.match(mime,/Cc: maria@aicaseleads.com\r\n/);assert.match(mime,/Reply-To: maria@aicaseleads.com\r\n/);
  const deliveredBody=Buffer.from(mime.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString();assert.ok(deliveredBody.includes('/interview/'+token));assert.ok(!deliveredBody.includes('Private owner interview note.'));
  const delivery=(await f.store.tasks()).find(item=>item.id===task.id)!;assert.equal(delivery.status,'done');assert.equal(delivery.payload.deliveryAccount,interviewer);
  const communication=(await f.store.getApplication(app.id)).communications.find(item=>item.purpose==='Interview invitation') as unknown as {status:string;cc:string[];replyTo:string[]};assert.equal(communication.status,'sent');assert.deepEqual(communication.cc,[interviewer]);assert.deepEqual(communication.replyTo,[interviewer]);
  await processHubTasks(f.store,f.db,undefined,undefined,3,[owner.email],resolve);assert.equal(sent,1);
  const replacement={action:'interview' as const,...DEFAULT_INTERVIEW,templateVersion:1,renew:true,expectedRevision:(await f.store.applicationRow(app.id)).revision};
  const renewed=await interviewMessage(f.store,owner,app.id,replacement);
  assert.deepEqual(renewed.envelope.replyTo,[interviewer]);assert.equal(renewed.interviewerEmail,interviewer);
  await submitInterviewInvitation(f.store,owner,app.id,{...replacement,previewFingerprint:renewed.fingerprint},env);
  const replacementTask=(await f.store.tasks()).find(item=>item.id.includes(':interview:')&&item.id!==task.id)!;
  assert.equal(replacementTask.payload.interviewerEmail,interviewer);
  f.database.prepare("UPDATE hub_tasks SET status='failed' WHERE id=?").run(replacementTask.id);f.database.prepare("UPDATE hub_communications SET status='failed' WHERE task_id=?").run(replacementTask.id);
  const recovery=await previewMailRecovery(f.store,owner,{from:Date.now()-60000,to:Date.now()+60000},{env,resolve:async(account)=>({verifyMailSender:async(sender,required)=>{assert.equal(account,interviewer);assert.equal(sender,interviewer);assert.equal(required,interviewer);}})});
  const recovered=recovery.messages.find(item=>item.kind==='Interview invitation')!;assert.ok(recovered);assert.deepEqual(recovered.replyTo,[interviewer]);assert.deepEqual(recovered.cc,[interviewer]);
  await f.store.stmt('UPDATE hub_members SET active=0 WHERE email=?',interviewer).run();
  await assert.rejects(()=>candidateMail(f.store,replacementTask.payload as never,[owner.email],{applicationId:app.id,mailMode:'recruiter',actor:owner.email,interview:true,interviewerEmail:replacementTask.payload.interviewerEmail}),{code:'interviewer_not_active'});
  const blocked=await previewMailRecovery(f.store,owner,{from:Date.now()-60000,to:Date.now()+60000},{env,resolve:async()=>{assert.fail('inactive interviewer must fail before transport verification');}});
  assert.equal(blocked.eligible,0);
 }finally{f.database.close();}
});
test('owners are valid job reply contacts and manual message copies; automatic mail never gains staff copies',async()=>{
 const f=createStore();try{
  const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
  const team=await validateTeam(f.store,{...emptyJobTeam,members:[owner.email],replyTo:owner.email},[owner.email]);assert.equal(team.replyTo,owner.email);
  const input={to:'candidate@example.invalid',subject:'Next steps',body:'Please reply with availability.',messageId:'owner-manual@example.invalid',cc:['forged@example.invalid']};
  const manual=await candidateMail(f.store,input,[owner.email],{mailMode:'recruiter',actor:owner.email,applicationId:app.id});assert.deepEqual(manual.cc,[owner.email]);assert.deepEqual(manual.replyTo,[owner.email]);
  const automatic=await candidateMail(f.store,input,[owner.email],{actor:owner.email,applicationId:app.id,rejection:true});assert.equal(automatic.sender,'no-reply-recruiting@aicaseleads.com');assert.equal(automatic.cc,undefined);assert.deepEqual(automatic.replyTo,['no-reply@notify.aicaseleads.com']);
 }finally{f.database.close();}
});
test('reviewed owner messages can verify recovery using the exact owner mailbox',async(t)=>{
 const previous=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner.email;t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous;});
 const f=createStore();try{
  const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
  await f.store.action(app.id,{action:'email',actionId:crypto.randomUUID(),subject:'Interview follow-up',body:'Please reply with your availability.',expectedRevision:(await f.store.applicationRow(app.id)).revision},owner);
  f.database.prepare("UPDATE hub_tasks SET status='failed',last_error='candidate_mail_account_connection_required',run_after=? WHERE kind='gmail'").run(Number.MAX_SAFE_INTEGER);f.database.prepare("UPDATE hub_communications SET status='failed'").run();
  let checks=0;const preview=await previewMailRecovery(f.store,owner,{from:Date.now()-60000,to:Date.now()+60000},{env:{ADMIN_EMAILS:owner.email},automatic:async()=>automaticFixture(),resolve:async(account)=>({verifyMailSender:async(sender,required)=>{checks++;assert.equal(account,owner.email);assert.equal(sender,owner.email);assert.equal(required,owner.email);}})});
  assert.equal(checks,1);const mail=preview.messages.find(item=>item.kind==='Recruiter message')!;assert.equal(mail.sender,owner.email);assert.deepEqual(mail.cc,[owner.email]);assert.deepEqual(mail.replyTo,[owner.email]);
 }finally{f.database.close();}
});

test('explicitly revoked owner membership blocks mailbox access and queued routing despite ADMIN_EMAILS',async()=>{
 const f=createStore();try{
  const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
  await f.store.setSetting(mailGrantKey(owner.email),{email:owner.email,sealedToken:await sealToken('synthetic-owner-refresh',env.GOOGLE_TOKEN_KEY),revision:0,fingerprint:await configurationFingerprint(env),connectedAt:1});
  assert.ok(await personalMailWorkspace(f.store,owner.email,env));
  f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,0,0,0)").run(owner.userId,owner.email,'admin');
  assert.equal(await personalMailWorkspace(f.store,owner.email,env),null);
  await assert.rejects(()=>validateTeam(f.store,{...emptyJobTeam,members:[owner.email],replyTo:owner.email},[owner.email]),{code:'invalid_job_team'});
  await assert.rejects(()=>candidateMail(f.store,{to:'candidate@example.invalid',subject:'Interview',body:'Choose a time',messageId:'revoked@example.invalid'},[owner.email],{applicationId:app.id,actor:owner.email,mailMode:'recruiter',interview:true}),{code:'recruiter_reply_contact_required'});
  const readiness=await interviewReadiness(f.store,owner,app.id,env);assert.equal(readiness.mailReady,false);assert.equal(readiness.mailIssue,'recruiter_reply_contact_required');assert.ok(!readiness.interviewers.some(person=>person.email===owner.email));
 }finally{f.database.close();}
});

test('immediate interview dispatch preserves uncertain Gmail delivery and prevents duplicate sends on retry', async t => {
 const previous=process.env.ADMIN_EMAILS;
 process.env.ADMIN_EMAILS=owner.email;
 t.after(()=>{if(previous===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=previous;});
 const f=createStore();
 t.after(()=>f.database.close());
 const job=await f.store.saveJob(jobInput()), app=await f.store.acceptApplication(applicationInput(job.id));
 const fingerprint=await configurationFingerprint(env);
 await f.store.setSetting(grantKey(owner.email),{email:owner.email,calendarId:owner.email,sealedToken:'calendar',revision:0,fingerprint,connectedAt:1});
 await f.store.setSetting(availabilityKey(owner.email),defaultAvailability);
 await f.store.setSetting(mailGrantKey(owner.email),{email:owner.email,sealedToken:'synthetic',revision:0,fingerprint,connectedAt:1});
 const input={action:'interview' as const,...DEFAULT_INTERVIEW,templateVersion:1,interviewerEmail:owner.email,expectedRevision:(await f.store.applicationRow(app.id)).revision};
 const preview=await interviewMessage(f.store,owner,app.id,input);
 const send={...input,previewFingerprint:preview.fingerprint};
 let sends=0;
 const transport={sendMail:async()=>{sends++;throw Object.assign(new Error('Gmail response lost'),{code:'gmail_response_lost',uncertain:true});}};
 const resolve=async()=>transport as unknown as import('../../lib/google/workspace').GoogleWorkspace;
 const result=await sendInterviewInvitation(f.store,owner,app.id,send,env,resolve);
 assert.equal(result.interviewDelivery.status,'uncertain');
 assert.equal(sends,1);
 const task=(await f.store.tasks()).find(item=>item.id.includes(':interview:'))!;
 assert.equal(await f.store.claimInterviewMail(task.id,app.id,Date.now()),null);
 assert.equal(task.status,'uncertain');
 assert.equal(sends,1);
});
