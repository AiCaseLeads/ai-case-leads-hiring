import assert from "node:assert/strict";
import { test } from "node:test";
import { HubStore } from "../../lib/hub/store";
import { handleHubRequest } from "../../lib/hub/http";
import { handleCandidateRequest } from "../../lib/hub/candidate";
import { createStore, jobInput, applicationInput, MANAGER, RECRUITER, currentAction, currentSettings, approveScheduling } from "./fixtures";

const origin = "https://jobs.example.invalid";
const request = (path:string,body:unknown,method="POST") => new Request(`${origin}${path}`,{method,headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
async function application(store:HubStore) {
  const job=await store.saveJob(jobInput());
  return {job,...await store.acceptApplication(applicationInput(job.id))};
}
function invitationToken(database:ReturnType<typeof createStore>["database"],id:string,kind:string) {
  const row=database.prepare("SELECT payload_json FROM hub_tasks WHERE application_id=? AND kind='gmail' AND instr(id,?)=1 AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 1").get(id,`gmail:${id}:${kind}:`)!;
  return JSON.parse(String(row.payload_json)).body.match(/\/(?:assessment|interview)\/([a-f0-9]{64})/)[1] as string;
}

test("a stale settings screen cannot restore a revoked recruiter, and successful access changes have an actor audit",async()=>{
  const {store,database}=createStore();
  await currentSettings(store,{members:[{email:MANAGER.email,role:"admin"},{email:RECRUITER.email,role:"recruiter"}]},MANAGER);
  const stale=await store.settings();
  await currentSettings(store,{members:[{email:MANAGER.email,role:"admin"}]},MANAGER);
  await assert.rejects(store.saveSettings({settingsVersion:stale.settingsVersion,members:stale.members.map(({email,role})=>({email,role})),interviewRemindersEnabled:true},MANAGER),{code:"settings_changed"});
  const current=await store.settings();
  assert.equal(current.members.find((member)=>member.email===RECRUITER.email)!.active,false);
  assert.equal(current.scheduling.remindersEnabled,false);
  assert.equal(current.accessAudit.length,2);
  assert.ok(current.accessAudit.every((entry)=>entry.actor===MANAGER.email));
  assert.equal(current.accessAudit[0].after.members instanceof Array,true);
  const attempts=await Promise.allSettled([store.saveSettings({settingsVersion:current.settingsVersion,interviewRemindersEnabled:true},MANAGER),store.saveSettings({settingsVersion:current.settingsVersion,interviewRemindersEnabled:false},MANAGER)]);
  assert.equal(attempts.filter((result)=>result.status==="fulfilled").length,1);
  assert.equal((await store.settings()).accessAudit.length,3);
  database.close();
});

test("stale staff rejection fails through HTTP before changing a hired application or queuing mail",async()=>{
  const {store,database}=createStore(),{id}=await application(store);
  const stale=await store.getApplication(id);
  await currentAction(store,id,{action:"stage",stage:"Hired"},MANAGER);
  const response=await handleHubRequest(request(`/api/hub/applications/${id}/action`,{action:"reject",reason:"Synthetic stale decision",expectedRevision:stale.revision}),["applications",id,"action"],RECRUITER,store);
  assert.equal(response.status,409);
  assert.equal((await store.getApplication(id)).stage,"Hired");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM hub_tasks WHERE instr(id,?)=1").get(`gmail:${id}:rejection:`)!.count,0);
  const missing=await handleHubRequest(request(`/api/hub/applications/${id}/action`,{action:"note",text:"Missing revision"}),["applications",id,"action"],MANAGER,store);
  assert.equal(missing.status,422);
  database.close();
});

test("one stale revision aborts the entire bulk decision and its emails",async()=>{
  const {store,database}=createStore(),{id:first,job}=await application(store),{id:second}=await store.acceptApplication(applicationInput(job.id));
  const expectedRevisions={[first]:1,[second]:1};
  await currentAction(store,second,{action:"stage",stage:"Offer"},MANAGER);
  const response=await handleHubRequest(request('/api/hub/bulk',{ids:[first,second],action:"reject",reason:"Synthetic bulk decision",expectedRevisions}),["bulk"],MANAGER,store);
  assert.equal(response.status,409);
  assert.equal((await store.getApplication(first)).stage,"Application Review");
  assert.equal((await store.getApplication(second)).stage,"Offer");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM hub_tasks WHERE instr(id,':rejection:')>0").get()!.count,0);
  database.close();
});

test("manual email action IDs distinguish new identical messages from retries and conflicting payloads",async()=>{
  const {store,database}=createStore(),{id}=await application(store);
  const actionId=crypto.randomUUID(),input={action:"email" as const,expectedRevision:1,actionId,subject:"Availability check",body:"Are you available this week?"};
  await store.action(id,input,MANAGER);
  await store.action(id,input,MANAGER);
  await store.action(id,{...input,actionId:actionId.toUpperCase()},MANAGER);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM hub_tasks WHERE instr(id,':manual:')>0").get()!.count,1);
  assert.equal((await store.getApplication(id)).revision,2);
  await assert.rejects(store.action(id,{...input,body:"Different body"},MANAGER),{code:"email_action_conflict"});
  await assert.rejects(store.action(id,input,RECRUITER),{code:"email_action_conflict"});
  await currentAction(store,id,{...input,expectedRevision:undefined,actionId:crypto.randomUUID()},MANAGER);
  const detail=await store.getApplication(id);
  assert.equal(detail.communications.filter((mail)=>mail.subject===input.subject).length,2);
  assert.equal(detail.history.filter((entry)=>entry.type==="email").length,2);
  database.close();
});

test("expired assessment renewal preserves its prompt/item ID and revokes queued old capabilities",async()=>{
  const {store,database}=createStore(),{id}=await application(store),realNow=Date.now;
  let now=realNow();Date.now=()=>now;
  try {
    await currentAction(store,id,{action:"assessment",text:"Original approved prompt"},MANAGER);
    const before=await store.getApplication(id),oldToken=invitationToken(database,id,"assessment");
    now+=8*86400000;
    await currentAction(store,id,{action:"assessment",renew:true,text:"This text must not replace the prompt"},MANAGER);
    const after=await store.getApplication(id),newToken=invitationToken(database,id,"assessment");
    assert.equal(after.assessment!.id,before.assessment!.id);assert.equal(after.assessment!.prompt,"Original approved prompt");
    assert.equal(after.assessments.length,1);assert.notEqual(newToken,oldToken);assert.equal(after.assessment!.linkActive,true);
    const old=await handleCandidateRequest(new Request(`${origin}/api/candidate/${oldToken}`),oldToken,store);
    assert.equal(old.status,404);
    assert.equal(after.communications.filter((mail)=>mail.status==="pending"&&mail.subject.startsWith("Assessment")).length,1);
    assert.equal(after.communications.filter((mail)=>mail.status==="cancelled"&&mail.subject.startsWith("Assessment")).length,1);
  } finally {Date.now=realNow;database.close();}
});

test("interview renewal preserves provider identity and remains usable past the original invitation expiry",async()=>{
  const {store,database}=createStore(),{id}=await application(store),realNow=Date.now;
  let now=realNow();Date.now=()=>now;
  try {
    await approveScheduling(store);await currentAction(store,id,{action:"interview"},MANAGER);
    const interview=(await store.latestInterview(id))!,oldToken=invitationToken(database,id,"interview");
    const end=new Date(now+27*86400000).toISOString(),start=new Date(Date.parse(end)-1800000).toISOString();
    database.prepare("UPDATE hub_interviews SET status='booked',start=?,end=?,provider_id='stable-provider',meet_url='https://meet.google.com/syn-thet-ics' WHERE id=?").run(start,end,interview.id);
    now+=15*86400000;await currentAction(store,id,{action:"interview"},MANAGER);
    const after=(await store.latestInterview(id))!,detail=await store.getApplication(id),token=invitationToken(database,id,"interview");
    assert.equal(after.id,interview.id);assert.equal(after.provider_id,"stable-provider");assert.equal(after.status,"booked");
    assert.ok(detail.interview!.linkExpiresAt!>=Date.parse(end)+86400000);assert.equal(detail.interviews.length,1);
    assert.equal((await handleCandidateRequest(new Request(`${origin}/api/candidate/${oldToken}`),oldToken,store,{busy:async()=>[]})).status,404);
    assert.equal((await handleCandidateRequest(new Request(`${origin}/api/candidate/${token}`),token,store,{busy:async()=>[]})).status,200);
  } finally {Date.now=realNow;database.close();}
});

test("application detail contains every assessment answer, interview and source parameter without invitation tokens",async()=>{
  const {store,database}=createStore();const job=await store.saveJob(jobInput()),input=applicationInput(job.id);
  input.utmData={utm_source:"synthetic",utm_campaign:"original-campaign",utm_medium:"referral"};
  const {id}=await store.acceptApplication(input);
  const stamp=Date.now();
  database.prepare("INSERT INTO hub_assessments(id,application_id,status,prompt,answer,submitted_at,created_at) VALUES(?,?,'submitted','First prompt','First answer',?,?)").run('first-assessment',id,stamp,stamp);
  await currentAction(store,id,{action:"assessment",text:"Second prompt"},MANAGER);
  database.prepare("INSERT INTO hub_interviews(id,application_id,status,start,end,time_zone,calendar_id,revision,created_at,updated_at) VALUES(?,?,'cancelled',?,?,'UTC','synthetic',1,?,?)").run('previous-interview',id,new Date(stamp).toISOString(),new Date(stamp+1800000).toISOString(),stamp,stamp);
  await approveScheduling(store);await currentAction(store,id,{action:"interview"},MANAGER);
  const token=invitationToken(database,id,"interview"),detail=await store.getApplication(id);
  assert.equal(detail.assessments.length,2);assert.ok(detail.assessments.some((item)=>item.answer==="First answer"));assert.equal(detail.interviews.length,2);
  assert.equal(detail.utmData.utm_campaign,"original-campaign");assert.equal(detail.formVersion,job.formVersion);assert.equal(JSON.stringify(detail).includes(token),false);
  database.close();
});

test("new and seeded jobs inherit the saved rejection default while existing role templates remain unchanged",async()=>{
  const {store,database}=createStore(),existing=await store.saveJob(jobInput());
  await currentSettings(store,{rejectionTemplate:"Approved saved default for {{name}}"},MANAGER);
  const {rejectionTemplate:unused,...newInput}=jobInput();void unused;
  assert.equal((await store.saveJob(newInput)).rejectionTemplate,"Approved saved default for {{name}}");
  const seeded=await store.seedDraftJobs();
  assert.ok(seeded.filter((job)=>job.status==="draft").every((job)=>job.rejectionTemplate==="Approved saved default for {{name}}"));
  assert.equal((await store.getJob(existing.id)).rejectionTemplate,existing.rejectionTemplate);database.close();
});

test("destination edits refuse existing or racing Calendar/Drive ownership instead of migrating silently",async()=>{
  const {store,database,db}=createStore();
  await currentSettings(store,{driveRootId:"original-root"},MANAGER);await approveScheduling(store);
  const {id}=await application(store);await currentAction(store,id,{action:"interview"},MANAGER);
  const interview=(await store.latestInterview(id))!;
  database.prepare("UPDATE hub_interviews SET status='pending',start=?,end=? WHERE id=?").run(new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+88200000).toISOString(),interview.id);
  await assert.rejects(currentSettings(store,{calendarId:"new-calendar"},MANAGER),{code:"calendar_change_blocked"});
  await assert.rejects(currentSettings(store,{driveRootId:"new-root"},MANAGER),{code:"drive_root_change_blocked"});
  const pristine=createStore();await currentSettings(pristine.store,{driveRootId:"root-before-race"},MANAGER);
  const originalBatch=pristine.db.batch.bind(pristine.db);let injected=false;
  pristine.db.batch=async(statements)=>{if(!injected){injected=true;pristine.database.prepare("INSERT INTO archive_items(key,drive_id,parent_id,updated_at) VALUES('recruiting','reserved-id','root-before-race',?)").run(Date.now());}return originalBatch(statements);};
  await assert.rejects(currentSettings(pristine.store,{driveRootId:"root-after-race"},MANAGER),{code:"settings_changed"});
  assert.equal(await pristine.store.setting("google_drive_root_id",""),"root-before-race");assert.equal((await pristine.store.auditLog()).length,1);
  void db;database.close();pristine.database.close();
});

test("same-role grade ordering uses one latest score per reviewer; qualification and duplicate flags stay independent",async()=>{
  const {store,database}=createStore(),{job,id:a}=await application(store);
  const b=(await store.acceptApplication(applicationInput(job.id))).id,c=(await store.acceptApplication(applicationInput(job.id))).id;
  await currentAction(store,a,{action:"scorecard",score:1,criteria:"Overall"},MANAGER);
  await currentAction(store,a,{action:"scorecard",score:5,criteria:"Overall revised"},MANAGER);
  await currentAction(store,a,{action:"scorecard",score:3,criteria:"Overall"},RECRUITER);
  await currentAction(store,b,{action:"scorecard",score:5,criteria:"Overall"},MANAGER);
  const ordered=await store.applications({jobId:job.id,sort:"grade_desc"});
  assert.deepEqual(ordered.items.map((item)=>item.id),[b,a,c]);assert.equal(ordered.items[1].grade.averageScore,4);assert.equal(ordered.items[1].grade.reviewerCount,2);assert.equal(ordered.items[1].qualification,"review");
  assert.equal((await store.applications({jobId:job.id,grade:"ungraded"})).items[0].id,c);
  await assert.rejects(store.applications({sort:"grade_desc"}),{code:"job_required_for_grading"});
  const duplicateInput=applicationInput(job.id),email=(await store.getApplication(a)).email;
  duplicateInput.fieldSubmissions=duplicateInput.fieldSubmissions.map((field)=>field.path==="_systemfield_email"?{...field,value:email}:field);
  await store.acceptApplication(duplicateInput);
  const duplicates=await store.applications({duplicate:true});assert.equal(duplicates.total,2);assert.ok(duplicates.items.every((item)=>item.duplicateEmail&&item.duplicateApplicationCount===2));
  assert.equal((await store.applications({qualification:"review"})).total,4);database.close();
});

test("long literal search and filtered cohort export avoid pattern interpretation and do not reveal capabilities",async()=>{
  const {store,database}=createStore();const job=await store.saveJob(jobInput()),input=applicationInput(job.id),name="Long synthetic name "+"界_%".repeat(25);
  input.fieldSubmissions[0].value=name;const {id}=await store.acceptApplication(input);
  await currentAction(store,id,{action:"assessment"},MANAGER);
  assert.equal((await store.applications({q:name})).total,1);assert.equal((await store.applications({q:"name"})).total,1);
  const token=invitationToken(database,id,"assessment"),exported=await store.exportApplications({jobId:job.id,q:name});
  assert.equal(exported.total,1);assert.equal(exported.truncated,false);assert.equal(exported.limit,10000);assert.equal(exported.items[0].id,id);assert.equal(JSON.stringify(exported).includes(token),false);database.close();
});

test("intentional reviewer edits in one millisecond use the latest score in both SQL ordering and detail grades",async()=>{
  const {store,database}=createStore(),{job,id}=await application(store),realNow=Date.now;
  const frozen=realNow();Date.now=()=>frozen;
  try {
    await currentAction(store,id,{action:"scorecard",score:1,criteria:"First overall review"},MANAGER);
    await currentAction(store,id,{action:"scorecard",score:5,criteria:"Edited overall review"},MANAGER);
    const cards=database.prepare("SELECT score,created_at FROM hub_scorecards WHERE application_id=? ORDER BY created_at").all(id);
    assert.equal(cards[0].created_at,frozen);assert.equal(cards[1].created_at,frozen+1);
    const detail=await store.getApplication(id),sorted=await store.applications({jobId:job.id,sort:"grade_desc"});
    assert.equal(detail.grade.averageScore,5);assert.equal(detail.grade.reviewerCount,1);assert.equal(detail.grade.scorecardCount,2);assert.equal(sorted.items[0].grade.averageScore,5);
  } finally {Date.now=realNow;database.close();}
});

test("repeated uncertain Gmail reconciliation does not create new hiring revisions or archive generations",async()=>{
  const {store,database}=createStore(),{id}=await application(store),taskId=`gmail:${id}:confirmation`;
  const start=Date.now();database.prepare("UPDATE hub_tasks SET status='running',lease_token='first',lease_until=? WHERE id=?").run(start+60000,taskId);
  await store.finishTask(taskId,'first',{status:"uncertain",error:"Synthetic unknown delivery"});
  const revision=(await store.applicationRow(id)).revision,archiveCount=database.prepare("SELECT COUNT(*) count FROM hub_tasks WHERE kind='drive'").get()!.count;
  for(let n=0;n<3;n++){const token=`again-${n}`;database.prepare("UPDATE hub_tasks SET status='running',lease_token=?,lease_until=? WHERE id=?").run(token,Date.now()+60000,taskId);await store.finishTask(taskId,token,{status:"uncertain",error:"No sent message found"});}
  assert.equal((await store.applicationRow(id)).revision,revision);assert.equal(database.prepare("SELECT COUNT(*) count FROM hub_tasks WHERE kind='drive'").get()!.count,archiveCount);
  database.prepare("UPDATE hub_tasks SET status='running',lease_token='found',lease_until=? WHERE id=?").run(Date.now()+60000,taskId);
  await store.finishTask(taskId,'found',{status:"done",result:{id:"synthetic-message",threadId:"synthetic-thread"}});
  assert.equal((await store.applicationRow(id)).revision,revision+1);assert.equal((await store.getApplication(id)).communications[0].status,"sent");database.close();
});

test("summary grades and cohort exports never transfer reviewer rationale while detail preserves it",async()=>{
  const {store,database,db}=createStore(),{job,id}=await application(store),text="Synthetic full reviewer rationale "+"x".repeat(5000),criteria="Detailed criterion "+"y".repeat(500);
  await currentAction(store,id,{action:"scorecard",score:2,text,criteria},MANAGER);
  await currentAction(store,id,{action:"scorecard",score:4,text,criteria},MANAGER);
  const originalPrepare=db.prepare.bind(db);let gradeQueries=0,transferredBytes=0;
  db.prepare=(sql)=>{
    const prepared=originalPrepare(sql),originalAll=prepared.all.bind(prepared);
    if(/FROM hub_scorecards WHERE application_id IN/.test(sql))prepared.all=async<T=Record<string,unknown>>()=>{
      const result=await originalAll<T>();gradeQueries++;
      for(const row of result.results) {
        assert.equal(Object.hasOwn(row as object,"text"),false);
        assert.equal(Object.hasOwn(row as object,"criteria"),false);
      }
      transferredBytes+=Buffer.byteLength(JSON.stringify(result.results));return result;
    };
    return prepared;
  };
  try {
    const list=await store.applications({jobId:job.id}),exported=await store.exportApplications({jobId:job.id}),overview=await store.overview();
    for(const item of [list.items[0],exported.items[0],overview.recentApplications[0]]) {
      assert.equal(item.grade.averageScore,4);assert.equal(item.grade.reviewerCount,1);assert.equal(item.grade.scorecardCount,2);
      assert.equal(JSON.stringify(item).includes(text),false);
      assert.ok(item.grade.latestReviews.every((review)=>review.text===""&&review.criteria===""));
    }
    assert.equal(gradeQueries,3);assert.ok(transferredBytes<2000,`Transferred ${transferredBytes} bytes for summary scorecards`);
    const detail=await store.getApplication(id);
    assert.equal(detail.scorecards[0].text,text);assert.equal(detail.grade.latestReviews[0].criteria,criteria);
  } finally {database.close();}
});

test("reports and overview stay bounded in transferred data with 6000 valid essay-bearing applications",async()=>{
  const {store,database,db}=createStore();const input=jobInput();input.fields.push({path:"essay",title:"Essay",type:"LongText",required:false});const job=await store.saveJob(input),submitted=applicationInput(job.id);
  submitted.fieldSubmissions.push({path:"essay",value:"x".repeat(20000)});const {id}=await store.acceptApplication(submitted),row=database.prepare("SELECT * FROM hub_applications WHERE id=?").get(id)!;
  const columns=Object.keys(row),insert=database.prepare(`INSERT INTO hub_applications (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`),history=database.prepare("INSERT INTO hub_history(id,application_id,type,text,actor,from_stage,to_stage,created_at) VALUES(?,?,'stage','Screening','synthetic','Application Review','Screening',?)");
  database.exec('BEGIN');for(let n=1;n<6000;n++){const next=crypto.randomUUID();insert.run(...columns.map((column)=>column==='id'||column==='submission_key_hash'?next:column==='email'?`synthetic-${n}@example.invalid`:column==='stage'?'Screening':row[column]));history.run(`history:${next}`,next,Date.now());}database.exec('COMMIT');
  const originalPrepare=db.prepare.bind(db);let transferredBytes=0;
  db.prepare=(sql)=>{const prepared=originalPrepare(sql),originalAll=prepared.all.bind(prepared);prepared.all=async<T=Record<string,unknown>>()=>{const result=await originalAll<T>();transferredBytes+=Buffer.byteLength(JSON.stringify(result.results));return result;};return prepared;};
  const report=await store.reports(),overview=await store.overview();assert.equal(report.applications,6000);assert.equal(overview.counts.applications,6000);assert.equal(overview.recentApplications.length,12);assert.ok(transferredBytes<5*1024*1024,`Transferred ${transferredBytes} bytes for aggregate views`);
  const exported=await store.exportApplications({jobId:job.id});assert.equal(exported.items.length,6000);assert.equal(exported.total,6000);assert.equal(exported.truncated,false);database.close();
});
