import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,currentAction} from './fixtures';
import {manageApplicantShare,sharedApplicant,sharedApplicantFile} from '../../lib/hub/applicant-share';
import {handleHubRequest} from '../../lib/hub/http';
const request=(method:string,body?:unknown)=>new Request('https://jobs.example.invalid/api/hub/applications/test/share',{method,headers:{origin:'https://jobs.example.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('staff sharing is explicit, scoped and hash-only; public profile omits private recruiting data',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 await currentAction(store,app.id,{action:'note',text:'INTERNAL SECRET NOTE'},MANAGER);
 assert.equal((await handleHubRequest(request('POST',{}),['applications',app.id,'share'],null as never,store)).status,403);
 const made=await handleHubRequest(request('POST',{}),['applications',app.id,'share'],MANAGER,store);assert.equal(made.status,200);
 const data=(await made.json() as {data:{url:string;expiresAt:number}}).data;const token=data.url.split('/').at(-1)!;assert.match(token,/^[a-f0-9]{64}$/);
 const settings=database.prepare("SELECT value FROM hub_settings WHERE key LIKE 'applicant_share:%'").all();assert.equal(settings.some(row=>String(row.value).includes(token)),false);
 database.prepare('UPDATE hub_jobs SET ai_match_enabled=1 WHERE id=?').run(job.id);
 database.prepare("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,review_json,warnings_json,error,updated_at) VALUES(?,?,?,'ready',88,?,'[\"PRIVATE WARNING\"]','PRIVATE ERROR',1)").run(app.id,job.id,job.formVersion,JSON.stringify({criteria:[{criterion:'Relevant experience',status:'evidence_found',explanation:'Applicant has relevant experience.',citations:[{source:'resume',quote:'Five years'}]}],checks:[]}));
 const publicResult=await sharedApplicant(store,token);assert.match(publicResult.headers.get('X-Robots-Tag')!,/noindex/);const body=await publicResult.text();assert.doesNotMatch(body,/INTERNAL SECRET NOTE|communications|assignee|driveFolder|qualificationEvidence|PRIVATE WARNING|PRIVATE ERROR|model|progress/);
 assert.equal(JSON.parse(body).aiMatch.score,88);
 assert.deepEqual(Object.keys(JSON.parse(body)).sort(),['aiMatch','answers','fields','files','jobTitle','name']);
 assert.deepEqual(await manageApplicantShare(store,app.id,'GET'),{active:true,expiresAt:data.expiresAt});
 await manageApplicantShare(store,app.id,'DELETE');await assert.rejects(sharedApplicant(store,token),{code:'share_unavailable'});
 }finally{database.close();}
});
test('share files enforce résumé ownership and immediately reject revoked, expired, trashed and rotated links',async()=>{
 const {store,database,db}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),other=await store.acceptApplication(applicationInput(job.id));
 const bytes=new TextEncoder().encode('%PDF-1.7\nsynthetic');
 const insert=database.prepare("INSERT INTO hub_files(id,session_hash,job_id,field_path,filename,content_type,size,object_key,expires_at,uploaded_at,application_id) VALUES(?,'test',?,?,'CV.pdf','application/pdf',?,?,1,1,?)");
 insert.run('resume',job.id,'_systemfield_resume',bytes.length,'key1',app.id);insert.run('other',job.id,'_systemfield_resume',bytes.length,'key2',other.id);insert.run('portfolio',job.id,'portfolio',bytes.length,'key3',app.id);
 const bucket={get:async()=>({size:bytes.length,customMetadata:{fileId:'resume'},body:new Response(bytes).body!})} as unknown as Pick<R2Bucket,'get'>;
 const create=async()=>{const result=await manageApplicantShare(store,app.id,'POST') as {url:string};return result.url.split('/').at(-1)!;};let token=await create();
 const req=new Request('https://jobs.example.invalid/file?preview=1');
 const response=await sharedApplicantFile(req,store,token,'resume',bucket);assert.equal(response.status,200);assert.match(response.headers.get('Content-Type')!,/pdf/);
 for(const id of ['other','portfolio','missing'])await assert.rejects(sharedApplicantFile(req,store,token,id,bucket),{code:'share_unavailable'});
 const old=token;token=await create();await assert.rejects(sharedApplicant(store,old),{code:'share_unavailable'});
 await store.setSetting('application_trash:'+app.id,{deletedAt:Date.now()});await assert.rejects(sharedApplicantFile(req,store,token,'resume',bucket),{code:'share_unavailable'});await db.prepare('DELETE FROM hub_settings WHERE key=?').bind('application_trash:'+app.id).run();
 const saved=await store.setting<Record<string,unknown>>('applicant_share:'+app.id,{});await store.setSetting('applicant_share:'+app.id,{...saved,expiresAt:1});await assert.rejects(sharedApplicant(store,token),{code:'share_unavailable'});
 await assert.rejects(sharedApplicant(store,'invalid'),{code:'share_unavailable'});
 }finally{database.close();}
});
