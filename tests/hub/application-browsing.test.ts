import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER} from './fixtures';
import {handleHubRequest} from '../../lib/hub/http';
import type {HubMember} from '../../lib/hub/auth-core';
import {privateApplicationFile} from '../../lib/hub/files';

const origin='https://jobs.example.invalid';
const req=(path:string,method='GET',body?:unknown,source=origin)=>new Request(origin+'/api/hub/'+path,{method,headers:{Origin:source,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});

test('view acknowledgement is private per staff, repeat-safe, and never changes recruiting records',async()=>{
 const {store,database}=createStore();try {
  const job=await store.saveJob(jobInput()),{id}=await store.acceptApplication(applicationInput(job.id));
  const before=await store.applicationRow(id);
  const counts=()=>database.prepare('SELECT (SELECT COUNT(*) FROM hub_history) AS history,(SELECT COUNT(*) FROM hub_tasks) AS tasks,(SELECT COUNT(*) FROM hub_application_views) AS views').get();
  const original=counts();
  assert.equal((await store.getApplication(id,MANAGER.email)).viewedAt,null);
  assert.equal((await store.applications({},MANAGER.email)).items[0].viewedAt,null);assert.deepEqual(counts(),original);
  assert.equal((await handleHubRequest(req(`applications/${id}/viewed`,'POST',{},'https://foreign.invalid'),['applications',id,'viewed'],MANAGER,store)).status,403);
  assert.equal((await handleHubRequest(req(`applications/${id}/viewed`,'POST',{}),['applications',id,'viewed'],null as unknown as HubMember,store)).status,403);
  assert.equal((await handleHubRequest(req(`applications/${id}/viewed`,'POST',{viewerEmail:RECRUITER.email}),['applications',id,'viewed'],MANAGER,store)).status,422);
  const response=await handleHubRequest(req(`applications/${id}/viewed`,'POST',{}),['applications',id,'viewed'],MANAGER,store);
  assert.equal(response.status,200);const first=(await response.json() as {data:{viewedAt:number}}).data.viewedAt;assert.ok(first>0);
  assert.equal((await store.markApplicationViewed(id,' '+MANAGER.email.toUpperCase()+' ')).viewedAt,first);
  assert.equal((await store.getApplication(id,RECRUITER.email)).viewedAt,null);
  assert.equal((await store.getApplication(id,MANAGER.email)).viewedAt,first);
  assert.equal((await store.applications({},MANAGER.email)).items[0].viewedAt,first);
  assert.equal((await store.applications({},RECRUITER.email)).items[0].viewedAt,null);
  assert.equal('viewedAt' in await store.getApplication(id),false);
  assert.deepEqual(await store.applicationRow(id),before);assert.deepEqual({...counts()},{...original,views:1});
 }finally{database.close();}
});

test('navigation follows exact date, qualification and ordering across page boundaries and excludes Trash',async()=>{
 const {store,database}=createStore();try {
  const job=await store.saveJob(jobInput());
  for(let n=0;n<65;n++){const app=await store.acceptApplication(applicationInput(job.id));database.prepare("UPDATE hub_applications SET qualification='pass',created_at=? WHERE id=?").run(Date.parse('2026-10-15T06:00Z')+n,app.id);}
  const rejected=await store.acceptApplication(applicationInput(job.id));database.prepare("UPDATE hub_applications SET qualification='fail' WHERE id=?").run(rejected.id);
  const filters={jobId:job.id,qualification:'pass' as const,appliedFrom:'2026-10-15',appliedTo:'2026-10-15',timeZone:'America/Bogota',sort:'newest' as const};
  const page1=await store.applications(filters),page2=await store.applications({...filters,page:2});
  const boundary=page1.items.at(-1)!.id;
  assert.deepEqual(await store.applicationNavigation(boundary,filters),{previousId:page1.items.at(-2)!.id,nextId:page2.items[0].id,position:30,total:65});
  assert.equal((await store.applicationNavigation(page1.items[0].id,filters)).previousId,null);
  assert.deepEqual(await store.applicationNavigation(rejected.id,filters),{previousId:null,nextId:page1.items[0].id,position:0,total:65,outsideView:true});
  const response=await handleHubRequest(req(`applications/${boundary}/navigation?`+new URLSearchParams(filters)),['applications',boundary,'navigation'],MANAGER,store);
  assert.equal(response.status,200);assert.equal((await response.json() as {data:{position:number}}).data.position,30);
  database.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES(?, '{}', 1)").run('application_trash:'+page2.items[0].id);
  assert.equal((await store.applicationNavigation(boundary,filters)).nextId,page2.items[1].id);
  assert.equal((await store.applicationNavigation(boundary,filters)).total,64);
  database.prepare('UPDATE hub_jobs SET ai_match_enabled=1 WHERE id=?').run(job.id);
  for(let n=0;n<12;n++)database.prepare("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,updated_at) VALUES(?,?,?,'ready',?,1)").run(page1.items[n].id,job.id,job.formVersion,100-n);
  const top={jobId:job.id,sort:'ai_match_desc' as const,top:10 as const};
  const topIds=await store.exportIds(top);assert.equal(topIds.length,10);
  assert.deepEqual(await store.applicationNavigation(topIds[9],top),{previousId:topIds[8],nextId:null,position:10,total:10});
  assert.deepEqual(await store.applicationNavigation(page1.items[11].id,top),{previousId:topIds[9],nextId:null,position:0,total:10,outsideView:true});
 }finally{database.close();}
});

test('private inline files require staff, verify bytes and identity, and protect PDF/image rendering',async()=>{
 const {store,database,db}=createStore();try {
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  const bytes=new TextEncoder().encode('%PDF-1.7\nsynthetic');
  database.prepare("INSERT INTO hub_files(id,session_hash,job_id,field_path,filename,content_type,size,object_key,expires_at,uploaded_at,application_id) VALUES('test-pdf','test',?,'resume','Résumé.pdf','application/pdf',?,'test-key',1,1,?)").run(job.id,bytes.length,app.id);
  const bucket=(body=bytes,fileId='test-pdf')=>({get:async()=>({size:bytes.length,customMetadata:{fileId},body:new Response(body as BodyInit).body!})}) as unknown as Pick<R2Bucket,'get'>;
  const request=(range?:string)=>new Request(origin+'/api/files/test-pdf?preview=1',{headers:range?{Range:range}:{}});
  await assert.rejects(privateApplicationFile(request(),'test-pdf',null,db,bucket()),{code:'staff_access_required'});
  const result=await privateApplicationFile(request(),'test-pdf',MANAGER,db,bucket());
  assert.equal(result.status,200);assert.match(result.headers.get('Content-Disposition')!,/^inline/);assert.match(result.headers.get('Content-Security-Policy')!,/sandbox/);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);
  const partial=await privateApplicationFile(request('bytes=0-4'),'test-pdf',MANAGER,db,bucket());assert.equal(partial.status,206);assert.equal(await partial.text(),'%PDF-');assert.equal(partial.headers.get('Content-Range'),`bytes 0-4/${bytes.length}`);
  assert.equal((await privateApplicationFile(request('bytes=999-'),'test-pdf',MANAGER,db,bucket())).status,416);
  await assert.rejects(privateApplicationFile(request(),'test-pdf',MANAGER,db,bucket(bytes,'wrong')),{code:'file_identity_mismatch'});
  await assert.rejects(privateApplicationFile(request(),'test-pdf',MANAGER,db,bucket(new Uint8Array(bytes.length))),{code:'preview_unavailable'});
  for(const mime of ['text/html','image/svg+xml','application/msword']){database.prepare('UPDATE hub_files SET content_type=? WHERE id=?').run(mime,'test-pdf');await assert.rejects(privateApplicationFile(request(),'test-pdf',MANAGER,db,bucket()),{code:'preview_unavailable'});}
  const attachment=await privateApplicationFile(new Request(origin+'/api/files/test-pdf'),'test-pdf',MANAGER,db,bucket());assert.match(attachment.headers.get('Content-Disposition')!,/^attachment/);
  assert.equal((await store.getApplication(app.id)).files[0].fieldPath,'resume');
 }finally{database.close();}
});

test('stale shortlisted anchor retains exact filtered neighbors across pages',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput());
 for(let n=0;n<65;n++){const app=await store.acceptApplication(applicationInput(job.id));database.prepare("UPDATE hub_applications SET qualification='pass',stage='Application Review',created_at=? WHERE id=?").run(Date.parse('2026-10-15T06:00Z')+n,app.id);}
 const filters={jobId:job.id,stage:'Application Review' as const,qualification:'pass' as const,sort:'newest' as const,appliedFrom:'2026-10-15',appliedTo:'2026-10-15',timeZone:'America/Bogota'};
 const p1=await store.applications(filters),p2=await store.applications({...filters,page:2}),anchor=p1.items[29].id;
 database.prepare("UPDATE hub_applications SET stage='Screening' WHERE id=?").run(anchor);
 assert.deepEqual(await store.applicationNavigation(anchor,filters),{previousId:p1.items[28].id,nextId:p2.items[0].id,position:0,total:64,outsideView:true});
 database.prepare("UPDATE hub_applications SET qualification='fail' WHERE id=?").run(p2.items[0].id);
 assert.equal((await store.applicationNavigation(anchor,filters)).nextId,p2.items[1].id);
 const other=await store.saveJob({...jobInput(),title:'Another job'}),foreign=await store.acceptApplication(applicationInput(other.id));
 await assert.rejects(store.applicationNavigation(foreign.id,filters),{code:'application_not_in_view'});
 assert.deepEqual(await store.applicationNavigation(anchor,{...filters,stage:'Rejected'}),{previousId:null,nextId:null,position:0,total:0,outsideView:true});
 }finally{database.close();}
});
