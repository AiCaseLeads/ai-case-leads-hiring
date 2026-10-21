import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER,RECRUITER,currentAction} from './fixtures';
import {markNotesReviewed} from '../../lib/hub/note-review';
import {handleHubRequest} from '../../lib/hub/http';
test('founder review requires saved notes, progresses without mail and remains protected from initial-review bulk rejection',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 const mails=()=>database.prepare("SELECT count(*) n FROM hub_tasks WHERE kind='gmail'").get()!.n;
 const before=mails();await assert.rejects(currentAction(store,app.id,{action:'stage',stage:'Awaiting Founder Review'},MANAGER),{code:'interview_notes_required'});
 await currentAction(store,app.id,{action:'note',text:'First interview completed; strong examples.'},RECRUITER);
 await currentAction(store,app.id,{action:'stage',stage:'Awaiting Founder Review'},RECRUITER);
 assert.equal((await store.applications({stage:'Awaiting Founder Review',active:true})).total,1);
 await currentAction(store,app.id,{action:'stage',stage:'Second Round Interview'},MANAGER);
 assert.equal(mails(),before);assert.equal((await store.applications({stage:'Second Round Interview',active:true})).total,1);
 assert.ok((await store.reports()).conversion.some(row=>row.stage==='Second Round Interview'&&row.count===1));
 await currentAction(store,app.id,{action:'stage',stage:'Application Review'},MANAGER);
 assert.equal((await store.previewBulkRejection({jobId:job.id},undefined,'Not selected',MANAGER)).count,0);
 }finally{database.close();}
});
test('note review is explicit per person and new or edited notes invalidate it without changing the applicant',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 await currentAction(store,app.id,{action:'note',text:'Interview note'},RECRUITER);
 const before=await store.applicationRow(app.id),first=(await store.getApplication(app.id,MANAGER.email)).notesReview!;
 assert.equal(first.count,1);assert.equal(first.hasUnread,true);
 await markNotesReviewed(store,app.id,MANAGER.email,first.version);
 assert.equal((await store.getApplication(app.id,MANAGER.email)).notesReview!.hasUnread,false);
 assert.equal((await store.applications({},MANAGER.email)).items[0].notesReview!.hasUnread,false);
 assert.equal((await store.getApplication(app.id,RECRUITER.email)).notesReview!.hasUnread,true);
 assert.deepEqual(await store.applicationRow(app.id),before);
 await currentAction(store,app.id,{action:'note',text:'Additional evidence'},RECRUITER);
 await assert.rejects(markNotesReviewed(store,app.id,MANAGER.email,first.version),{code:'notes_changed'});
 const second=(await store.getApplication(app.id,MANAGER.email)).notesReview!;await markNotesReviewed(store,app.id,MANAGER.email,second.version);
 database.prepare("UPDATE hub_history SET text='Edited interview note' WHERE application_id=? AND type='note'").run(app.id);
 assert.equal((await store.getApplication(app.id,MANAGER.email)).notesReview!.hasUnread,true);
 const request=new Request('https://jobs.example.invalid/api/hub/applications/'+app.id+'/notes-reviewed',{method:'POST',headers:{origin:'https://other.invalid','content-type':'application/json'},body:JSON.stringify({expectedNotesVersion:second.version})});
 assert.equal((await handleHubRequest(request,['applications',app.id,'notes-reviewed'],MANAGER,store)).status,403);
 }finally{database.close();}
});
test('a note edit racing the review write cannot mark unseen text reviewed',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 await currentAction(store,app.id,{action:'note',text:'Original'},RECRUITER);
 const version=(await store.getApplication(app.id,MANAGER.email)).notesReview!.version;
 const original=store.stmt.bind(store);let raced=false;
 store.stmt=(...args:Parameters<typeof store.stmt>)=>{
  if(!raced&&args[0].startsWith('INSERT INTO hub_settings(key,value,updated_at) SELECT')){raced=true;database.prepare("UPDATE hub_history SET text='Changed while marking' WHERE application_id=? AND type='note'").run(app.id);}
  return original(...args);
 };
 await assert.rejects(markNotesReviewed(store,app.id,MANAGER.email,version),{code:'notes_changed'});
 assert.equal((await store.getApplication(app.id,MANAGER.email)).notesReview!.hasUnread,true);
 }finally{database.close();}
});
