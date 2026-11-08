import test from 'node:test';
import {registerHooks} from 'node:module';
import type {HubMember} from '../../lib/hub/auth';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER,currentAction} from './fixtures';
import {getRecruiterReview,saveRecruiterReview,workflowOverview,saveWorkflowSettings,canApproveHiring,listRoleInterviews,attachInterviewEvidence,workflowNotificationMail} from '../../lib/hub/recruiting-workflow';
import {markNotesReviewed} from '../../lib/hub/note-review';
import {handleHubRequest} from '../../lib/hub/http';
const complete={recommendation:'advance' as const,notes:'Clear ownership of the production system.',summary:'Interview completed; strong technical examples.',recordingUrl:'https://app.meetgeek.ai/meeting/example',salaryExpectation:'USD 3,000 per month',availability:'Two weeks; US Central hours',concerns:'None'};
async function fixture(){const f=createStore(),job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id));return {...f,job,app};}
async function reviewed(store:Awaited<ReturnType<typeof fixture>>['store'],id:string,member:HubMember=MANAGER){const d=await store.getApplication(id,member.email);await markNotesReviewed(store,id,member.email,d.notesReview!.version);}
test('complete recording-based founder handoff is required; saves produce unread history and stale edits conflict',async()=>{
 const f=await fixture();try{
 const {store,app}=f;const empty=await getRecruiterReview(store,app.id,RECRUITER);assert.equal(empty.version,0);assert.equal(empty.readiness.missing.length,7);
 await currentAction(store,app.id,{action:'note',text:'A note alone is insufficient'},RECRUITER);
 await assert.rejects(currentAction(store,app.id,{action:'stage',stage:'Awaiting Founder Review'},RECRUITER),{code:'interview_handoff_incomplete'});
 const saved=await saveRecruiterReview(store,app.id,{expectedVersion:0,...complete},RECRUITER);assert.equal(saved.readiness.ready,true);assert.equal(saved.version,1);
 await assert.rejects(saveRecruiterReview(store,app.id,{expectedVersion:0,...complete},RECRUITER),{code:'review_changed'});
 await currentAction(store,app.id,{action:'stage',stage:'Awaiting Founder Review'},RECRUITER);assert.equal((await store.getApplication(app.id,MANAGER.email)).notesReview!.hasUnread,true);
 await assert.rejects(currentAction(store,app.id,{action:'stage',stage:'Second Round Interview'},MANAGER),{code:'notes_review_required'});
 await reviewed(store,app.id);await currentAction(store,app.id,{action:'stage',stage:'Second Round Interview'},MANAGER);
 await saveRecruiterReview(store,app.id,{expectedVersion:1,...complete,concerns:'Clarify system scale'},RECRUITER);
 await assert.rejects(currentAction(store,app.id,{action:'stage',stage:'Offer'},MANAGER),{code:'notes_review_required'});
 }finally{f.database.close();}
});
test('only owner and explicit active approvers can make decisions; an ordinary admin cannot',async()=>{
 const f=await fixture();try{
 const {store,database,app}=f;for(const [id,email,role] of [['maria','mariam@aicaseleads.com','recruiter'],['other','other@example.invalid','admin']])database.prepare('INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)').run(id,email,role);
 const maria={...RECRUITER,email:'mariam@aicaseleads.com'},other={...RECRUITER,email:'other@example.invalid',role:'admin' as const};assert.equal(await canApproveHiring(store,maria),true);assert.equal(await canApproveHiring(store,other),false);
 await saveRecruiterReview(store,app.id,{expectedVersion:0,...complete},RECRUITER);await reviewed(store,app.id,other);
 await assert.rejects(currentAction(store,app.id,{action:'stage',stage:'Offer'},other),{code:'hiring_approval_required'});
 await reviewed(store,app.id,maria);await currentAction(store,app.id,{action:'stage',stage:'Second Round Interview'},maria);
 await assert.rejects(saveWorkflowSettings(store,{approvers:['other@example.invalid']},other),{code:'owner_access_required'});
 await saveWorkflowSettings(store,{approvers:['other@example.invalid']},MANAGER);assert.equal(await canApproveHiring(store,maria),false);assert.equal(await canApproveHiring(store,other),true);
 database.prepare("UPDATE hub_members SET active=0 WHERE id='other'").run();assert.equal(await canApproveHiring(store,other),false);
 }finally{f.database.close();}
});
test('all recruiters may review roles; claim and unassigned queues work with explicit stage filters',async()=>{
 const f=await fixture();try{
 const {store,app}=f;let q=await workflowOverview(store,RECRUITER);assert.equal(q.counts.unassigned,1);assert.equal(q.myQueue.length,0);
 await currentAction(store,app.id,{action:'assign',assignee:RECRUITER.email},RECRUITER);q=await workflowOverview(store,RECRUITER);assert.equal(q.counts.unassigned,0);assert.equal(q.counts.myUnreviewed,1);
 await currentAction(store,app.id,{action:'reject',reason:'Not selected'},RECRUITER);assert.equal((await store.applications({active:true,stage:'Rejected'})).total,1);
 assert.equal((await store.applications({active:true})).total,0);
 }finally{f.database.close();}
});
test('MeetGeek evidence fills missing fields without overwriting recruiter summary and remains idempotent',async()=>{
 const f=await fixture();try{
 const {store,app}=f;await saveRecruiterReview(store,app.id,{expectedVersion:0,...complete,recordingUrl:''},RECRUITER);
 const evidence={summary:'AI summary',recordingUrl:'/api/hub/meetgeek/meetings/meeting-id/recording',transcript:'Interview transcript',providerMeetingId:'meeting-id'};
 const imported=await attachInterviewEvidence(store,app.id,evidence,'meetgeek');assert.equal(imported.summary,complete.summary);assert.equal(imported.recordingUrl,evidence.recordingUrl);
 const again=await attachInterviewEvidence(store,app.id,evidence,'meetgeek');assert.equal(again.version,imported.version);
 await assert.rejects(saveRecruiterReview(store,app.id,{expectedVersion:again.version,...complete,recordingUrl:'javascript:alert(1)'},RECRUITER),{code:'invalid_recruiter_review'});
 }finally{f.database.close();}
});
test('handoff email task is internal, deduplicated, and suppressed after leaving founder review',async()=>{
 const f=await fixture();try{
 const {store,app,database}=f;database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES('maria','mariam@aicaseleads.com','recruiter',1,0,0)").run();
 await saveRecruiterReview(store,app.id,{expectedVersion:0,...complete},RECRUITER);await currentAction(store,app.id,{action:'stage',stage:'Awaiting Founder Review'},RECRUITER);
 const row=database.prepare("SELECT * FROM hub_tasks WHERE json_extract(payload_json,'$.workflowNotification')=1").get()!;assert.ok(row);const task={...row,applicationId:app.id,payload:JSON.parse(String(row.payload_json))} as never;
 const mail=await workflowNotificationMail(task,store);assert.equal(mail!.to,'mariam@aicaseleads.com');assert.ok(mail!.body.includes('/team?'));
 await currentAction(store,app.id,{action:'stage',stage:'Awaiting Founder Review'},RECRUITER);assert.equal(database.prepare("SELECT count(*) n FROM hub_tasks WHERE json_extract(payload_json,'$.workflowNotification')=1").get()!.n,1);
 await currentAction(store,app.id,{action:'stage',stage:'Screening'},RECRUITER);assert.equal(await workflowNotificationMail(task,store),null);
 }finally{f.database.close();}
});
test('interview workspace filters by role and owner and recruiter-review endpoints reject cross-origin writes',async()=>{
 const f=await fixture();try{
 const {store,database,job,app}=f;database.prepare("INSERT INTO hub_interviews(id,application_id,provider_id,status,start,end,revision,created_at,updated_at) VALUES('interview',?,'calendar-event','booked','2025-01-01T12:00:00.000Z','2025-01-01T12:30:00.000Z',1,0,0)").run(app.id);
 await saveRecruiterReview(store,app.id,{expectedVersion:0,...complete},RECRUITER);
 assert.equal((await listRoleInterviews(store,{jobId:job.id,status:'completed'})).total,0,'a past appointment alone does not establish attendance');
 assert.equal((await listRoleInterviews(store,{progress:'attendance_due'})).total,1);
 database.prepare("UPDATE hub_interviews SET attended=0 WHERE id='interview'").run();
 assert.equal((await listRoleInterviews(store,{progress:'no_show'})).total,1);
 assert.equal((await listRoleInterviews(store,{status:'completed'})).total,0);
 database.prepare("UPDATE hub_interviews SET attended=1 WHERE id='interview'").run();
 assert.equal((await listRoleInterviews(store,{jobId:job.id,progress:'completed'})).items[0].interviewProgress,'completed');
 assert.equal((await listRoleInterviews(store,{jobId:job.id,status:'completed'})).items[0].recordingUrl,null,'application recording cannot be attributed to every interview');
 await attachInterviewEvidence(store,app.id,{providerMeetingId:'recorded-interview',interviewId:'interview',recordingUrl:complete.recordingUrl,summary:'This interview'},'meetgeek');
 assert.equal((await listRoleInterviews(store,{jobId:job.id})).items[0].recordingUrl,complete.recordingUrl);
 assert.equal((await listRoleInterviews(store,{jobId:job.id,status:'completed'})).total,1);assert.equal((await listRoleInterviews(store,{owner:'another@example.invalid'})).total,0);
 const get=new Request('https://jobs.example.invalid/api/hub/applications/'+app.id+'/recruiter-review');assert.equal((await handleHubRequest(get,['applications',app.id,'recruiter-review'],RECRUITER,store)).status,200);
 const bad=new Request(get.url,{method:'PUT',headers:{origin:'https://other.invalid','content-type':'application/json'},body:JSON.stringify({expectedVersion:1,...complete})});assert.equal((await handleHubRequest(bad,['applications',app.id,'recruiter-review'],RECRUITER,store)).status,403);
 }finally{f.database.close();}
});
test('interview pages retain full matching count and stable non-overlapping ordering',async()=>{
 const f=await fixture();try{
 const {store,database,app}=f;
 for(let index=0;index<105;index++)database.prepare("INSERT INTO hub_interviews(id,application_id,status,start,end,revision,created_at,updated_at) VALUES(?,?,'booked','2025-01-01T12:00:00.000Z','2025-01-01T12:30:00.000Z',1,0,0)").run('interview-'+String(index).padStart(3,'0'),app.id);
 const first=await listRoleInterviews(store,{jobId:f.job.id}),second=await listRoleInterviews(store,{jobId:f.job.id,page:2}),last=await listRoleInterviews(store,{jobId:f.job.id,page:3});
 assert.equal(first.total,105);assert.equal(first.page,1);assert.equal(first.pageSize,50);assert.equal(first.items.length,50);assert.equal(second.items.length,50);assert.equal(last.items.length,5);assert.equal(new Set([...first.items,...second.items,...last.items].map(item=>item.id)).size,105);
 const response=await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/interviews?page=2&pageSize=100'),['interviews'],RECRUITER,store);const data=(await response.json() as {data:{total:number;page:number;items:unknown[]}}).data;assert.equal(data.total,105);assert.equal(data.page,2);assert.equal(data.items.length,5);
 await assert.rejects(listRoleInterviews(store,{page:0}),{code:'invalid_interview_page'});await assert.rejects(listRoleInterviews(store,{pageSize:101}),{code:'invalid_interview_page'});
 }finally{f.database.close();}
});
test('MeetGeek asynchronous connection failures use the hub JSON error boundary',async()=>{
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = {};',shortCircuit:true};return next(specifier,context);}});
 const f=await fixture();try{
 const response=await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/meetgeek/sync',{method:'POST',headers:{origin:'https://jobs.example.invalid','content-type':'application/json'},body:'{}'}),['meetgeek','sync'],MANAGER,f.store);
 assert.equal(response.status,409);assert.match(response.headers.get('content-type')||'',/application\/json/);
 const body=await response.json() as {error:{code:string;message:string}};assert.equal(body.error.code,'meetgeek_not_connected');assert.match(body.error.message,/Connect MeetGeek/);
 }finally{hooks.deregister();f.database.close();}
});
