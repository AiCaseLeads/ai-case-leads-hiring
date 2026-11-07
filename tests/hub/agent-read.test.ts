import test from 'node:test';
import {makePdf} from '../pdf/fixtures';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput} from './fixtures';
import {issueAccess} from '../../lib/agent-api/access';
import {handleAgentRead} from '../../lib/agent-api/read';
const request=(token:string,query:string)=>new Request('https://jobs.example.invalid/api/agent-read?'+query,{headers:{authorization:'Bearer '+token}});
test('read scopes reject invalid, expired, revoked and write-only tokens',async()=>{const {store,database}=createStore();try{
 assert.equal((await handleAgentRead(request('invalid','action=list_jobs'),store)).status,401);
 const access=await issueAccess(store,'qa',['jobs:read'],'owner');assert.equal((await handleAgentRead(request(access.token,'action=list_jobs'),store)).status,200);assert.equal((await handleAgentRead(request(access.token,'action=list_applicants'),store)).status,403);
 const record=await store.setting<Record<string,unknown>>('agent_access_'+access.id,{});await store.setSetting('agent_access_'+access.id,{...record,expiresAt:1});assert.equal((await handleAgentRead(request(access.token,'action=list_jobs'),store)).status,403);await store.setSetting('agent_access_'+access.id,{...record,revoked:true});assert.equal((await handleAgentRead(request(access.token,'action=list_jobs'),store)).status,403);
 const write=await issueAccess(store,'write',['jobs:draft','jobs:publish'],'owner');assert.equal((await handleAgentRead(request(write.token,'action=list_jobs'),store)).status,403);
 }finally{database.close()}});
test('job and applicant filtering paginate on server and never return trashed applicants',async()=>{const {store,database}=createStore();try{
 const access=await issueAccess(store,'qa',['jobs:read','applicants:read'],'owner'),job=await store.saveJob({...jobInput(),title:'Needle role'});await store.saveJob({...jobInput(),title:'Other role'});
 const jobs=await (await handleAgentRead(request(access.token,'action=list_jobs&q=Needle&pageSize=1'),store)).json() as {data:{total:number;items:unknown[]}};assert.equal(jobs.data.total,1);assert.equal(jobs.data.items.length,1);
 for(let index=0;index<34;index++){const app=await store.acceptApplication(applicationInput(job.id));if(index===0)await store.setSetting('application_trash:'+app.id,{deletedAt:Date.now()});if(index===33)database.prepare("UPDATE hub_applications SET stage='Rejected' WHERE id=?").run(app.id)}
 const query='action=list_applicants&jobId='+job.id+'&stage=Application%20Review';const first=await(await handleAgentRead(request(access.token,query),store)).json() as {data:{total:number;items:{id:string}[]}},second=await(await handleAgentRead(request(access.token,query+'&page=2'),store)).json() as typeof first;assert.equal(first.data.total,32);assert.equal(first.data.items.length,30);assert.equal(second.data.items.length,2);
 assert.equal((await handleAgentRead(request(access.token,'action=list_applicants&stage=invalid'),store)).status,422);assert.equal((await handleAgentRead(request(access.token,query+'&trash=true'),store)).status,422);
 }finally{database.close()}});
test('detail redacts invitation capabilities and files require both scopes, ownership and active application',async()=>{const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),other=await store.acceptApplication(applicationInput(job.id));
 const both=await issueAccess(store,'both',['applicants:read','files:read'],'owner'),read=await issueAccess(store,'read',['applicants:read'],'owner'),fileOnly=await issueAccess(store,'file',['applicants:read','files:read'],'owner');
 const fileOnlyRecord=await store.setting<Record<string,unknown>>('agent_access_'+fileOnly.id,{});await store.setSetting('agent_access_'+fileOnly.id,{...fileOnlyRecord,scopes:['files:read']});
 const fileId='f'.repeat(64),bytes=makePdf('Synthetic resume text for scoped reading.');database.prepare('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(fileId,job.id,'_systemfield_resume','resume.pdf','application/pdf',bytes.length,'private/original',1,app.id,Date.now()+1000,'a'.repeat(64));
 database.prepare('INSERT INTO hub_history(id,application_id,type,text,actor,created_at) VALUES(?,?,?,?,?,?)').run('note',app.id,'note','Private link https://jobs.example.invalid/interview/'+'a'.repeat(64)+' and https://jobs.example.invalid/shared-applicants/'+'%62'.repeat(64),'recruiter',1);
 const query='&applicationId='+app.id+'&fileId='+fileId;let gets=0;const bucket={get:async()=>{gets++;return {size:bytes.length,customMetadata:{fileId},body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close()}})}}} as unknown as Pick<R2Bucket,'get'>;
 assert.equal((await handleAgentRead(request(read.token,'action=file_content'+query),store,bucket)).status,403);assert.equal((await handleAgentRead(request(fileOnly.token,'action=file_content'+query),store,bucket)).status,403);assert.equal(gets,0);
 assert.equal((await handleAgentRead(request(both.token,'action=file_content&applicationId='+other.id+'&fileId='+fileId),store,bucket)).status,404);assert.equal(gets,0);
 const content=await handleAgentRead(request(both.token,'action=file_content'+query),store,bucket);assert.equal(content.status,200);assert.deepEqual(new Uint8Array(await content.arrayBuffer()),bytes);const extracted=await(await handleAgentRead(request(both.token,'action=file_text'+query),store,bucket)).json() as {data:{text:string;status:string}};assert.equal(extracted.data.status,'ready');assert.match(extracted.data.text,/Synthetic resume text/);
 const detail=await handleAgentRead(request(read.token,'action=get_applicant&applicationId='+app.id),store);assert.equal(detail.status,200);const text=await detail.text();assert.ok(text.includes('[redacted-token]'));assert.ok(!text.includes('a'.repeat(64)));assert.ok(!text.includes('%62'));assert.ok(text.includes(fileId));assert.ok(!text.includes('private/original'));const logs=database.prepare("SELECT actor,after_json FROM hub_audit WHERE type='agent_read'").all();assert.ok(logs.length>0);assert.ok(logs.every(row=>String(row.actor).startsWith('agent:')));assert.ok(!JSON.stringify(logs).includes('Private link'));
 await store.setSetting('application_trash:'+app.id,{deletedAt:1});assert.equal((await handleAgentRead(request(both.token,'action=get_applicant&applicationId='+app.id),store)).status,404);assert.equal((await handleAgentRead(request(both.token,'action=file_content'+query),store,bucket)).status,404);
 }finally{database.close()}});

test('detail section pagination and transcript chunks expose only application-bound allowlisted evidence',async()=>{const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),access=await issueAccess(store,'read',['applicants:read'],'owner');
 for(let index=0;index<12;index++)database.prepare('INSERT INTO hub_history(id,application_id,type,text,actor,created_at) VALUES(?,?,?,?,?,?)').run('qa'+index,app.id,'note','Question evidence '+index,'reviewer',index+100);
 await store.setSetting('interview_evidence:'+app.id+':meeting-a',{providerMeetingId:'meeting-a',summary:'Call reviewed',transcript:'x'.repeat(40001),sealedToken:'must-not-escape',objectKey:'private-secret'});
 await store.setSetting('interview_evidence:other:meeting-a',{transcript:'another applicant transcript'});
 await store.setSetting('interview_recording:local-recording',{applicationId:app.id,id:'local-recording',filename:'call.mp4',contentType:'video/mp4',size:100,createdAt:1,objectKey:'must-not-escape'});
 const query='action=get_applicant&applicationId='+app.id+'&sectionPageSize=5&notesPage=2',res=await handleAgentRead(request(access.token,query),store),data=(await res.json() as {data:{notes:{total:number;items:unknown[];page:number};evidence:{total:number;items:{transcriptTruncated:boolean}[]};recordings:{items:unknown[]}}}).data;
 assert.equal(data.notes.total,12);assert.equal(data.notes.page,2);assert.equal(data.notes.items.length,5);assert.equal(data.evidence.total,1);assert.equal(data.evidence.items[0].transcriptTruncated,true);assert.equal(data.recordings.items.length,1);assert.ok(!JSON.stringify(data).includes('must-not-escape'));assert.ok(!JSON.stringify(data).includes('another applicant'));
 const last=await(await handleAgentRead(request(access.token,'action=get_interview_evidence&applicationId='+app.id+'&meetingId=meeting-a&textPage=3'),store)).json() as {data:{transcript:string;hasMore:boolean;totalCharacters:number}};assert.equal(last.data.transcript,'x');assert.equal(last.data.hasMore,false);assert.equal(last.data.totalCharacters,40001);
 assert.equal((await handleAgentRead(request(access.token,'action=list_applicants&pageSize=1000'),store)).status,422);
 }finally{database.close()}});
