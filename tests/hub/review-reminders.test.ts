import { automaticFixture } from './automatic-fixture';
import assert from "node:assert/strict";
import test from "node:test";
import { createStore,jobInput,applicationInput,MANAGER,RECRUITER } from "./fixtures";
import { CONFIG_KEY,DEFAULT_CONFIG,activeStaff,configuration,enqueueReviewReminders,overdueQueue,reviewReminderMail,reminderDay } from "../../lib/review-reminders/service";
import { handleReviewReminders } from "../../lib/review-reminders/http";
const origin="https://jobs.example.invalid";
const now=Date.parse("2026-10-10T17:00:00Z"),due=now-48*3600000;
function request(body?:unknown,source=origin){return new Request(`${origin}/api/review-reminders`,{method:body?"PATCH":"GET",headers:{origin:source,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});}
async function fixture(){
  const f=createStore({origin});
  const job=await f.store.saveJob(jobInput());
  const app=await f.store.acceptApplication(applicationInput(job.id));
  f.database.prepare("UPDATE hub_applications SET stage_entered_at=? WHERE id=?").run(due,app.id);
  f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,?,1,?,?)").run("recruiter",RECRUITER.email,"recruiter",now,now);
  const config={enabled:true,dueHours:48,fallbackAdmins:[MANAGER.email]};
  await f.store.setSetting(CONFIG_KEY,config);
  return {...f,app,config,owners:[MANAGER.email]};
}
test("overdue queue includes boundary, excludes newer, terminal and graded applications; notes do not count as grade",async()=>{
  const f=await fixture();
  assert.equal((await overdueQueue(f.store,f.config,now)).total,1);
  assert.equal((await overdueQueue(f.store,f.config,now-1)).total,0);
  f.database.prepare("UPDATE hub_applications SET stage='Screening'").run();assert.equal((await overdueQueue(f.store,f.config,now)).total,0);
  for(const stage of ["Rejected","Withdrawn","Hired"]){f.database.prepare("UPDATE hub_applications SET stage=?").run(stage);assert.equal((await overdueQueue(f.store,f.config,now)).total,0);}
  f.database.prepare("UPDATE hub_applications SET stage='Application Review'").run();
  const a=await f.store.getApplication(f.app.id);
  await f.store.action(a.id,{action:"note",expectedRevision:a.revision,text:"AI evidence or notes are not a human grade"},MANAGER);
  assert.equal((await overdueQueue(f.store,f.config,now)).total,1);
  f.database.prepare("INSERT INTO hub_scorecards(id,application_id,actor,score,criteria,text,created_at) VALUES ('score',?,?,4,'[]','Checked',?)").run(a.id,MANAGER.email,now);
  assert.equal((await overdueQueue(f.store,f.config,now)).total,0);
  f.database.close();
});
test("reminder settings are disabled by default, admin-only, origin checked and accept only authorized manager fallback",async()=>{
  const f=createStore();assert.deepEqual(await configuration(f.store),DEFAULT_CONFIG);
  assert.equal((await handleReviewReminders(request(),null,f.store)).status,403);
  const config={enabled:true,dueHours:48,fallbackAdmins:[MANAGER.email]};
  assert.equal((await handleReviewReminders(request(config),RECRUITER,f.store,[MANAGER.email])).status,403);
  assert.equal((await handleReviewReminders(request(config,"https://evil.invalid"),MANAGER,f.store,[MANAGER.email])).status,403);
  assert.equal((await handleReviewReminders(request({...config,fallbackAdmins:[]}),MANAGER,f.store,[MANAGER.email])).status,422);
  assert.equal((await handleReviewReminders(request(config),MANAGER,f.store)).status,422);
  assert.equal((await handleReviewReminders(request({...config,dueHours:0}),MANAGER,f.store,[MANAGER.email])).status,422);
  assert.equal((await handleReviewReminders(request({...config,extra:true}),MANAGER,f.store,[MANAGER.email])).status,422);
  assert.equal((await handleReviewReminders(request(config),MANAGER,f.store,[MANAGER.email])).status,200);
  assert.equal((await activeStaff(f.store,[MANAGER.email]))[0].role,"admin");
  f.database.close();
});
test("concurrent scheduler ticks enqueue only one bounded daily digest, never candidate email; retry preserves message id",async()=>{
  const f=await fixture();
  const counts=await Promise.all(Array.from({length:10},()=>enqueueReviewReminders(f.store,f.owners,now)));
  assert.equal(counts.reduce((a,b)=>a+b,0),1);
  const tasks=(await f.store.tasks()).filter(t=>t.payload.reviewReminder);
  assert.equal(tasks.length,1);assert.equal(tasks[0].kind,"gmail");
  assert.ok(JSON.stringify(tasks[0].payload).length<1000);
  const mail=await reviewReminderMail(tasks[0],f.store,f.owners,now);
  assert.equal(mail!.to,MANAGER.email);assert.equal(mail!.subject,"Hiring review reminder");
  assert.match(mail!.body,/1 application/);assert.match(mail!.body,/\/team\?reviews=overdue/);
  assert.deepEqual(await reviewReminderMail(tasks[0],f.store,f.owners,now),mail);
  assert.equal(await enqueueReviewReminders(f.store,f.owners,now+24*3600000),1);
  assert.equal(await reviewReminderMail(tasks[0],f.store,f.owners,now+24*3600000),null);
  f.database.close();
});
test("assigned active recruiter receives own reminder; reassigning or revoking recipient suppresses queued delivery",async()=>{
  const f=await fixture();
  f.database.prepare("UPDATE hub_applications SET assignee=?").run(RECRUITER.email);
  await enqueueReviewReminders(f.store,f.owners,now);
  const task=(await f.store.tasks()).find(t=>t.payload.reviewReminder)!;
  assert.equal((await reviewReminderMail(task,f.store,f.owners,now))!.to,RECRUITER.email);
  f.database.prepare("UPDATE hub_applications SET assignee=NULL").run();
  assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
  assert.equal(await enqueueReviewReminders(f.store,f.owners,now),1);
  f.database.prepare("UPDATE hub_applications SET assignee=?").run(RECRUITER.email);
  f.database.prepare("UPDATE hub_members SET active=0").run();
  assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
  const fallback=(await f.store.tasks()).find(t=>t.payload.reviewReminder&&t.payload.recipient===MANAGER.email)!;
  assert.equal((await reviewReminderMail(fallback,f.store,f.owners,now))!.to,MANAGER.email);
  assert.equal(await reviewReminderMail(fallback,f.store,[],now),null);
  f.database.close();
});
test("disabled settings, changed threshold, completed review and removed fallback prevent stale delivery",async()=>{
  const f=await fixture();await enqueueReviewReminders(f.store,f.owners,now);
  const task=(await f.store.tasks()).find(t=>t.payload.reviewReminder)!;
  await f.store.setSetting(CONFIG_KEY,{...f.config,enabled:false});
  assert.equal(await enqueueReviewReminders(f.store,f.owners,now),0);assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
  await f.store.setSetting(CONFIG_KEY,{...f.config,dueHours:49});assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
  await f.store.setSetting(CONFIG_KEY,{...f.config,fallbackAdmins:[]});assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
  await f.store.setSetting(CONFIG_KEY,f.config);f.database.prepare("UPDATE hub_applications SET stage='Screening'").run();assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
  f.database.close();
});
test("1000 overdue applicants paginate completely while producing one small digest per recipient",async()=>{
  const f=await fixture();
  const row=f.database.prepare("SELECT * FROM hub_applications WHERE id=?").get(f.app.id)!;
  const fields=Object.keys(row),sql=`INSERT INTO hub_applications(${fields.join(",")}) VALUES (${fields.map(()=>"?").join(",")})`,insert=f.database.prepare(sql);
  for(let i=1;i<1000;i++)insert.run(...fields.map(k=>k==="id"?`load-${String(i).padStart(4,"0")}`:k==="submission_key_hash"?`load-hash-${i}`:row[k] as string|number|null));
  const ids=new Set<string>();
  for(let offset=0;offset<1000;offset+=50){const page=await overdueQueue(f.store,f.config,now,offset);assert.equal(page.total,1000);assert.equal(page.applications.length,50);page.applications.forEach(a=>ids.add(a.id));}
  assert.equal(ids.size,1000);
  assert.equal(await enqueueReviewReminders(f.store,f.owners,now),1);
  const task=(await f.store.tasks()).find(t=>t.payload.reviewReminder)!;
  assert.match((await reviewReminderMail(task,f.store,f.owners,now))!.body,/1000 applications/);
  assert.ok(JSON.stringify(task.payload).length<1000);
  f.database.close();
});
test("Bogota day boundaries and queue filters are consistent",async()=>{
  assert.equal(reminderDay(Date.parse("2026-10-11T04:59:59Z")),"2026-10-10");assert.equal(reminderDay(Date.parse("2026-10-11T05:00:00Z")),"2026-10-11");
  const f=await fixture();
  assert.equal((await overdueQueue(f.store,f.config,now,0,"")).total,1);
  assert.equal((await overdueQueue(f.store,f.config,now,0,RECRUITER.email)).total,0);
  f.database.prepare("UPDATE hub_applications SET assignee=?").run(RECRUITER.email);
  assert.equal((await overdueQueue(f.store,f.config,now,0,RECRUITER.email)).total,1);
  assert.equal((await overdueQueue(f.store,f.config,now,0,"")).total,0);
  f.database.close();
});
test("worker uses automatic outbox once, reconciles uncertain delivery without resending and skips disabled queued mail",async(t)=>{
 const prior=process.env.CANDIDATE_MAIL_ACCOUNT;process.env.CANDIDATE_MAIL_ACCOUNT="mariam@aicaseleads.com";t.after(()=>{if(prior===undefined)delete process.env.CANDIDATE_MAIL_ACCOUNT;else process.env.CANDIDATE_MAIL_ACCOUNT=prior;});
  const { processHubTasks }=await import("../../lib/task-runner");
  const f=await fixture(),live=Date.now();
  f.database.prepare("UPDATE hub_applications SET stage_entered_at=?").run(live-49*3600000);
  f.database.prepare("UPDATE hub_tasks SET status='done',result_json=?").run(JSON.stringify({archivedRevision:999}));
  let sends=0,reconciles=0;
  const google={async sendMail(){sends++;throw {code:"gmail_outcome_unknown",uncertain:true};},async reconcileMail(){reconciles++;return {id:"delivered",threadId:"digest-thread"};}} as unknown as import("../../lib/google/workspace").GoogleWorkspace;
  await processHubTasks(f.store,f.db,undefined,google,1,f.owners,async()=>google,async()=>automaticFixture(async mail=>({...await google.sendMail(mail)}),async messageId=>({...await google.reconcileMail(messageId)})));
  const task=(await f.store.tasks()).find(t=>t.payload.reviewReminder)!;
  assert.equal(task.status,"uncertain");assert.equal(sends,1);
  f.database.prepare("UPDATE hub_tasks SET run_after=0 WHERE id=?").run(task.id);
  await processHubTasks(f.store,f.db,undefined,google,1,f.owners,async()=>google,async()=>automaticFixture(async mail=>({...await google.sendMail(mail)}),async messageId=>({...await google.reconcileMail(messageId)})));
  assert.equal(sends,1);assert.equal(reconciles,1);assert.equal((await f.store.tasks()).find(t=>t.id===task.id)!.status,"done");
  // A distinct queued digest can be safely cancelled when the switch is off.
  const extraId="review-reminder:test-stale";
  await f.store.taskStatement(extraId,f.app.id,"gmail",{...task.payload},Date.now()).run();
  await f.store.setSetting(CONFIG_KEY,{...f.config,enabled:false});
  await processHubTasks(f.store,f.db,undefined,google,1,f.owners,async()=>google,async()=>automaticFixture(async mail=>({...await google.sendMail(mail)}),async messageId=>({...await google.reconcileMail(messageId)})));
  assert.equal(sends,1);const stale=(await f.store.tasks()).find(t=>t.id===extraId)!;assert.equal(stale.status,"done");assert.deepEqual(stale.result,{stale:true});
  f.database.close();
});
test("fast repeated worker ticks do not rescan applications after each daily digest exists",async()=>{
  const f=await fixture();await enqueueReviewReminders(f.store,f.owners,now);
  // All overdue applications are unassigned: the recruiter has no matching
  // queue, but the already-queued manager no longer needs a candidate scan.
  const original=f.store.stmt.bind(f.store);let recipientScans=0;
  f.store.stmt=(sql,...values)=>{if(sql.includes("MIN(a.id) AS anchor"))recipientScans++;return original(sql,...values);};
  for(let i=0;i<12;i++)assert.equal(await enqueueReviewReminders(f.store,f.owners,now+i*5000),0);
  assert.equal(recipientScans,12); // Only the recruiter who has no digest yet.
  f.database.close();
});
test("stage changes reset waiting time while notes and assignment leave the stage clock unchanged",async()=>{
  const f=await fixture();let app=await f.store.getApplication(f.app.id);
  app=await f.store.action(app.id,{action:"assign",assignee:RECRUITER.email,expectedRevision:app.revision},MANAGER);
  assert.equal((await overdueQueue(f.store,f.config,now)).total,1);
  app=await f.store.action(app.id,{action:"stage",stage:"Screening",expectedRevision:app.revision},MANAGER);
  app=await f.store.action(app.id,{action:"stage",stage:"Application Review",expectedRevision:app.revision},MANAGER);
  const row=f.database.prepare("SELECT stage_entered_at AS entered FROM hub_applications WHERE id=?").get(app.id) as {entered:number};
  assert.equal((await overdueQueue(f.store,f.config,row.entered+48*3600000-1)).total,0);
  assert.equal((await overdueQueue(f.store,f.config,row.entered+48*3600000)).total,1);
  f.database.close();
});
test("a downgraded fallback manager receives only assigned applications, never an unassigned digest",async()=>{
  const f=await fixture();await enqueueReviewReminders(f.store,f.owners,now);
  const task=(await f.store.tasks()).find(t=>t.payload.reviewReminder)!;
  f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,?,1,?,?)").run("former-manager",MANAGER.email,"recruiter",now,now);
  assert.equal(await reviewReminderMail(task,f.store,[],now),null);
  f.database.prepare("UPDATE hub_applications SET assignee=?").run(MANAGER.email);
  const ownMail=await reviewReminderMail(task,f.store,[],now);
  assert.equal(ownMail!.to,MANAGER.email);assert.ok(!ownMail!.body.includes("manager fallback"));
  f.database.close();
});
test("Trash and archived jobs leave both the overdue queue and already queued reminders; paused intake keeps active reviews",async()=>{
  const f=await fixture();
  try {
    await enqueueReviewReminders(f.store,f.owners,now);
    const task=(await f.store.tasks()).find(t=>t.payload.reviewReminder)!;
    const app=await f.store.getApplication(f.app.id);
    await f.store.setSetting('application_trash:'+app.id,{deletedAt:now});
    assert.equal((await overdueQueue(f.store,f.config,now)).total,0);
    assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
    f.database.prepare('DELETE FROM hub_settings WHERE key=?').run('application_trash:'+app.id);
    for(const state of ['archived','deleted']) {
      await f.store.setSetting('job_lifecycle_'+app.jobId,{state});
      assert.equal((await overdueQueue(f.store,f.config,now)).total,0);
      assert.equal(await reviewReminderMail(task,f.store,f.owners,now),null);
    }
    await f.store.setSetting('job_lifecycle_'+app.jobId,{state:'active'});
    f.database.prepare("UPDATE hub_jobs SET status='closed' WHERE id=?").run(app.jobId);
    assert.equal((await overdueQueue(f.store,f.config,now)).total,1);
    assert.ok(await reviewReminderMail(task,f.store,f.owners,now));
  } finally {f.database.close();}
});
test("personal overdue scope normalizes both assignee and requester and excludes unassigned applications",async()=>{
  const f=await fixture();
  try {
    assert.equal((await overdueQueue(f.store,f.config,now,0,RECRUITER.email)).total,0);
    f.database.prepare('UPDATE hub_applications SET assignee=?').run(' '+RECRUITER.email.toUpperCase()+' ');
    assert.equal((await overdueQueue(f.store,f.config,now,0,' '+RECRUITER.email.toUpperCase()+' ')).total,1);
    assert.equal((await overdueQueue(f.store,f.config,now,0,'')).total,0);
    assert.equal((await overdueQueue(f.store,f.config,now,0,MANAGER.email)).total,0);
  } finally {f.database.close();}
});
