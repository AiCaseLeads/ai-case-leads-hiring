import assert from "node:assert/strict";
import test from "node:test";
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER} from "./fixtures";
import {handleJobTeam} from "../../lib/job-team/http";
import {handleJobSetup} from "../../lib/job-setup/http";
import {emptyJobTeam,jobTeam,jobNotificationMail,jobNotificationStatements,candidateReplyTo} from "../../lib/job-team/service";
import {CONFIG_KEY,enqueueReviewReminders,reviewReminderMail} from "../../lib/review-reminders/service";
import {mimeMessage} from "../../lib/google/gmail";
const origin="https://jobs.example.invalid",other="other@example.invalid";
function request(method:string,body?:unknown,jobId=""){return new Request(`${origin}/api/job-team${jobId?`?jobId=${jobId}`:""}`,{method,headers:{origin,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});}
async function fixture(){const f=createStore();for(const email of [RECRUITER.email,other])f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,'recruiter',1,0,0)").run(email,email);return f;}
async function configure(f:Awaited<ReturnType<typeof fixture>>,jobId:string,members:string[],extra:Record<string,unknown>={}){const response=await handleJobTeam(request("PUT",{jobId,expectedRevision:0,...emptyJobTeam,members,...extra}),MANAGER,f.store,[MANAGER.email]);assert.equal(response.status,200,await response.clone().text());return response;}
test("job teams are private authorized manager settings, deduplicate members and preserve explicit empty config",async()=>{
 const f=await fixture(),job=await f.store.saveJob(jobInput());
 assert.equal((await handleJobTeam(request("GET"),null,f.store)).status,403);
 assert.equal((await handleJobTeam(request("PUT",{jobId:job.id}),RECRUITER,f.store)).status,403);
 assert.equal((await handleJobTeam(request("PUT",{jobId:job.id,expectedRevision:0,...emptyJobTeam,members:["stranger@example.invalid"]}),MANAGER,f.store)).status,422);
 await configure(f,job.id,[RECRUITER.email,RECRUITER.email],{replyTo:RECRUITER.email});
 assert.deepEqual((await jobTeam(f.store,job.id))!.members,[RECRUITER.email]);
 assert.equal((await handleJobTeam(request("PUT",{jobId:job.id,expectedRevision:0,...emptyJobTeam}),MANAGER,f.store)).status,409);
 assert.equal((await handleJobTeam(request("PUT",{jobId:job.id,expectedRevision:1,...emptyJobTeam}),MANAGER,f.store)).status,200);
 assert.deepEqual((await jobTeam(f.store,job.id))!.members,[]);
 const choices=await (await handleJobTeam(request("GET"),MANAGER,f.store,[MANAGER.email])).json() as {data:{staff:{email:string}[];config:unknown}};
 assert.equal(choices.data.config,null);assert.equal(choices.data.staff.length,3);
 f.database.close();
});
test("two jobs deliver only to their multiple selected staff; submission retries do not duplicate notifications",async()=>{
 const f=await fixture(),first=await f.store.saveJob(jobInput()),second=await f.store.saveJob(jobInput());
 await configure(f,first.id,[RECRUITER.email,MANAGER.email]);await configure(f,second.id,[other]);
 const input=applicationInput(first.id),a=await f.store.acceptApplication(input),b=await f.store.acceptApplication(applicationInput(second.id));
 await f.store.acceptApplication(input);
 const notices=(await f.store.tasks()).filter(task=>task.payload.jobNotification===true);
 assert.equal(notices.length,3);
 assert.deepEqual(notices.filter(t=>t.applicationId===a.id).map(t=>t.payload.recipient).sort(),[RECRUITER.email,MANAGER.email].sort());
 assert.deepEqual(notices.filter(t=>t.applicationId===b.id).map(t=>t.payload.recipient),[other]);
 for(const task of notices){const mail=await jobNotificationMail(task,f.store,[MANAGER.email]);assert.equal(mail?.to,task.payload.recipient);assert.match(mail!.body,/application=app_/);}
 f.database.close();
});
test("delivery rechecks active membership, removed team members and preferences without fallback",async()=>{
 const f=await fixture(),job=await f.store.saveJob(jobInput());await configure(f,job.id,[RECRUITER.email],{replyTo:RECRUITER.email});await f.store.setSetting("google_sender",MANAGER.email);
 await f.store.acceptApplication(applicationInput(job.id));const task=(await f.store.tasks()).find(t=>t.payload.jobNotification)!;
 assert.deepEqual(await candidateReplyTo(f.store,task.applicationId),[RECRUITER.email,MANAGER.email]);
 f.database.prepare("UPDATE hub_members SET active=0 WHERE email=?").run(RECRUITER.email);
 assert.equal(await jobNotificationMail(task,f.store),null);assert.equal(await candidateReplyTo(f.store,task.applicationId),undefined);
 f.database.prepare("UPDATE hub_members SET active=1").run();
 await configure(f,job.id,[],{expectedRevision:1});assert.equal(await jobNotificationMail(task,f.store),null);
 f.database.close();
});
test("settings changes never backfill old submissions or imported historic replies; assessment and reply event ids are deduplicated",async()=>{
 const f=await fixture(),job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));
 await configure(f,job.id,[RECRUITER.email]);assert.equal((await f.store.tasks()).filter(t=>t.payload.jobNotification).length,0);
 assert.equal((await jobNotificationStatements(f.store,job.id,app.id,"reply","historic",Date.now(),1)).length,0);
 for(const event of ["assessmentSubmission","reply"] as const){const statements=await jobNotificationStatements(f.store,job.id,app.id,event,event,Date.now());await f.db.batch(statements);await f.db.batch(await jobNotificationStatements(f.store,job.id,app.id,event,event,Date.now()));}
 assert.equal((await f.store.tasks()).filter(t=>t.payload.jobNotification).length,2);f.database.close();
});
test("configured job reminder teams override assignee and global fallback, including empty team and opt out",async()=>{
 const f=await fixture(),jobs=await Promise.all([1,2,3,4].map(()=>f.store.saveJob(jobInput())));
 await configure(f,jobs[0].id,[RECRUITER.email,other]);await configure(f,jobs[1].id,[]);await configure(f,jobs[2].id,[MANAGER.email],{notifyOverdueReviews:false});
 for(const job of jobs)await f.store.acceptApplication(applicationInput(job.id));
 const now=Date.now();f.database.prepare("UPDATE hub_applications SET stage_entered_at=?,assignee=?").run(now-49*3600000,MANAGER.email);
 await f.store.setSetting(CONFIG_KEY,{enabled:true,dueHours:48,fallbackAdmins:[MANAGER.email]});
 assert.equal(await enqueueReviewReminders(f.store,[MANAGER.email],now),3);
 const tasks=(await f.store.tasks()).filter(t=>t.payload.reviewReminder===true);
 for(const task of tasks){const mail=await reviewReminderMail(task,f.store,[MANAGER.email],now);assert.match(mail!.body,/1 application/);}
 await configure(f,jobs[0].id,[],{expectedRevision:1});
 assert.equal(await reviewReminderMail(tasks.find(t=>t.payload.recipient===RECRUITER.email)!,f.store,[MANAGER.email],now),null);
 f.database.close();
});
test("wizard creates team atomically, preserves omission, rejects stale team revision without saving other fields",async()=>{
 const f=await fixture();const id=crypto.randomUUID(),input={action:"save",creationId:id,job:jobInput(),location:{workModel:"remote",country:"Spain",city:""},expectedBinding:null,scorecard:null,hiringTeam:{...emptyJobTeam,members:[RECRUITER.email],replyTo:RECRUITER.email},expectedTeamRevision:0};
 assert.equal((await handleJobSetup(request("POST",input),MANAGER,f.store,[MANAGER.email])).status,200);assert.equal((await jobTeam(f.store,id))!.revision,1);
 assert.equal((await handleJobSetup(request("POST",input),MANAGER,f.store,[MANAGER.email])).status,200);assert.equal((await jobTeam(f.store,id))!.revision,1);
 const job=await f.store.getJob(id),update={...input,creationId:crypto.randomUUID(),jobId:id,formVersion:job.formVersion,job:{...input.job,title:"Should not save"}};
 assert.equal((await handleJobSetup(request("POST",update),MANAGER,f.store,[MANAGER.email])).status,409);assert.equal((await f.store.getJob(id)).title,input.job.title);
 const {hiringTeam:_,expectedTeamRevision:__,...omitted}=update;void _;void __;
 assert.equal((await handleJobSetup(request("POST",omitted),MANAGER,f.store,[MANAGER.email])).status,200);assert.equal((await jobTeam(f.store,id))!.revision,1);
 f.database.close();
});
test("Reply-To retains actual From, validates addresses and never permits header injection",()=>{
 const input={to:"candidate@example.invalid",subject:"Application",body:"Received",messageId:"<test@example.invalid>",replyTo:[RECRUITER.email,MANAGER.email]};
 const raw=mimeMessage(MANAGER.email,input);assert.match(raw,/From: manager@example.invalid\r\n/);assert.match(raw,/Reply-To: recruiter@example.invalid, manager@example.invalid\r\n/);
 assert.throws(()=>mimeMessage(MANAGER.email,{...input,replyTo:["person@example.invalid\r\nBcc: attacker@example.invalid"]}));
});
test("actual assessment submission enqueues once with its event and retries leave one notification",async()=>{
 const {handleCandidateRequest}=await import("../../lib/hub/candidate"),{currentAction}=await import("./fixtures");
 const f=await fixture(),job=await f.store.saveJob(jobInput());await configure(f,job.id,[RECRUITER.email]);const app=await f.store.acceptApplication(applicationInput(job.id));
 await currentAction(f.store,app.id,{action:"assessment"},MANAGER);
 const mail=(await f.store.tasks()).find(t=>t.id.includes(":assessment:"))!,token=String(mail.payload.body).match(/\/assessment\/([a-f0-9]{64})/)![1];
 const submit=()=>handleCandidateRequest(new Request(`${origin}/api/candidate/${token}`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({action:"assessment",answer:"Synthetic answer"})}),token,f.store);
 assert.equal((await submit()).status,200);assert.equal((await submit()).status,200);
 assert.equal((await f.store.tasks()).filter(t=>t.payload.event==="assessmentSubmission").length,1);f.database.close();
});
test("worker routes recipient envelopes, preserves shared sender reply copy, and reconciles uncertain job notifications without resending",async()=>{
 const {processHubTasks}=await import("../../lib/task-runner");
 const f=await fixture(),job=await f.store.saveJob(jobInput());await configure(f,job.id,[RECRUITER.email],{replyTo:RECRUITER.email});await f.store.setSetting("google_sender",MANAGER.email);await f.store.acceptApplication(applicationInput(job.id));
 f.database.prepare("UPDATE hub_tasks SET status='done',result_json=? WHERE kind='drive'").run(JSON.stringify({archivedRevision:999}));
 const sent:import("../../lib/google/gmail").MailInput[]=[];
 const google={async sendMail(mail:import("../../lib/google/gmail").MailInput){sent.push(mail);if(mail.to===RECRUITER.email)throw {code:"gmail_outcome_unknown",uncertain:true};return {id:"candidate-delivered",threadId:"candidate-thread"};},async reconcileMail(){return {id:"notice-delivered",threadId:"team-thread"};}} as unknown as import("../../lib/google/workspace").GoogleWorkspace;
 await processHubTasks(f.store,f.db,undefined,google,5,[MANAGER.email]);assert.equal(sent.length,2,JSON.stringify(await f.store.tasks()));
 assert.deepEqual(sent.find(mail=>mail.to!==RECRUITER.email)!.replyTo,[RECRUITER.email,MANAGER.email]);assert.equal(sent.find(mail=>mail.to===RECRUITER.email)!.replyTo,undefined);
 const notice=(await f.store.tasks()).find(t=>t.payload.jobNotification)!;assert.equal(notice.status,"uncertain");
 f.database.prepare("UPDATE hub_tasks SET run_after=0 WHERE id=?").run(notice.id);
 await processHubTasks(f.store,f.db,undefined,google,1,[MANAGER.email]);assert.equal(sent.length,2);assert.equal((await f.store.tasks()).find(t=>t.id===notice.id)!.status,"done");f.database.close();
});
test("actual inbound reply sync creates a single job-team notice and never sends for external outbound mail",async()=>{
 const {syncHiringReplies}=await import("../../lib/mail-sync");
 const f=await fixture(),job=await f.store.saveJob(jobInput());await configure(f,job.id,[RECRUITER.email]);const app=await f.store.acceptApplication(applicationInput(job.id));
 const outgoing=(await f.store.tasks()).find(t=>t.id.endsWith(":confirmation"))!;
 f.database.prepare("UPDATE hub_communications SET status='sent',thread_id='known-thread',provider_id='outgoing' WHERE task_id=?").run(outgoing.id);
 const message={id:"candidate-reply",threadId:"known-thread",messageId:"<reply@example.invalid>",from:(await f.store.applicationRow(app.id)).email,subject:"Re: application",body:"Synthetic reply",sent:false,createdAt:Date.now(),inReplyTo:String(outgoing.payload.messageId),references:String(outgoing.payload.messageId),attachments:[]};
 const google={async profile(){return {email:MANAGER.email,historyId:"1"};},async mailHistory(){return {historyId:"1",messages:[]};},async threadMessages(){return [message,{...message,id:"outbound",sent:true}];}} as unknown as import("../../lib/google/workspace").GoogleWorkspace;
 assert.equal(await syncHiringReplies(f.store,f.db,google,10),2);
 await f.store.setSetting("gmail_thread_next_poll:known-thread",0);await syncHiringReplies(f.store,f.db,google,10);
 assert.equal((await f.store.tasks()).filter(t=>t.payload.event==="reply").length,1);f.database.close();
});
