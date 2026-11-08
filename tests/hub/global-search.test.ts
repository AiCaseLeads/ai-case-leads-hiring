import test from 'node:test';
import assert from 'node:assert/strict';
import {searchWorkspace} from '../../lib/hub/global-search';
import {createStore,jobInput,applicationInput,RECRUITER} from './fixtures';

const params=(q:string,page=1)=>new URLSearchParams({q,page:String(page)});
test('workspace search is staff-only and bounds query and pagination',async()=>{const f=createStore();try{await assert.rejects(searchWorkspace(f.store,null,params('Jane')),{code:'staff_access_required'});for(const p of [params('x'),params('x'.repeat(129)),params('Jane',0),params('Jane',1001),new URLSearchParams({q:'Jane',page:'1.5'})])await assert.rejects(searchWorkspace(f.store,RECRUITER,p),{code:'invalid_search'});}finally{f.database.close()}});
test('search finds people across roles and terminal stages, excludes Trash and returns summary fields only',async()=>{const f=createStore();try{
 const jobs=await Promise.all([f.store.saveJob({...jobInput(),title:'Design Operations'}),f.store.saveJob({...jobInput(),title:'Engineering'})]);
 const apps=[];for(const [i,job] of jobs.entries()){const input=applicationInput(job.id);input.fieldSubmissions[0].value='Jordan Test';input.fieldSubmissions[1].value=`jordan${i}@example.invalid`;apps.push(await f.store.acceptApplication(input));}
 await f.store.stmt("UPDATE hub_applications SET stage='Rejected' WHERE id=?",apps[1].id).run();
 let result=await searchWorkspace(f.store,RECRUITER,params('Jordan'));assert.equal(result.applications.total,2);assert.deepEqual(new Set(result.applications.items.map(x=>x.jobId)),new Set(jobs.map(x=>x.id)));assert.ok(result.applications.items.some(x=>x.stage==='Rejected'));assert.ok(!JSON.stringify(result).includes('answers'));assert.ok(!JSON.stringify(result).includes('session_hash'));
 await f.store.setSetting('application_trash:'+apps[0].id,{deletedAt:1});result=await searchWorkspace(f.store,RECRUITER,params('Jordan'));assert.equal(result.applications.total,1);assert.equal(result.applications.items[0].stage,'Rejected');
 result=await searchWorkspace(f.store,RECRUITER,params('jordan1@example.invalid'));assert.equal(result.applications.items[0].id,apps[1].id);
 result=await searchWorkspace(f.store,RECRUITER,params('Engineering'));assert.equal(result.jobs.total,1);assert.equal(result.applications.total,0);
 }finally{f.database.close()}});
test('literal wildcard queries do not turn into match-all, phone search is normalized, pages stable and jobs Trash hidden',async()=>{const f=createStore();try{
 const job=await f.store.saveJob({...jobInput(),title:'Engineer 100%'});
 for(let i=0;i<12;i++){const input=applicationInput(job.id);input.fieldSubmissions[0].value=i===0?'Engineer 100%':'Engineer Candidate';const app=await f.store.acceptApplication(input);if(i===0)await f.store.stmt('UPDATE hub_applications SET answers_json=? WHERE id=?',JSON.stringify([{path:'_systemfield_phone',value:'+1 (555) 123-4567'}]),app.id).run();}
 assert.equal((await searchWorkspace(f.store,RECRUITER,params('100%'))).applications.total,1);
 assert.equal((await searchWorkspace(f.store,RECRUITER,params('__'))).applications.total,0);
 assert.equal((await searchWorkspace(f.store,RECRUITER,params("' OR 1=1 --"))).applications.total,0);
 assert.equal((await searchWorkspace(f.store,RECRUITER,params('5551234567'))).applications.total,1);
 const first=await searchWorkspace(f.store,RECRUITER,params('Engineer')),second=await searchWorkspace(f.store,RECRUITER,params('Engineer',2));assert.equal(first.applications.items.length,10);assert.equal(second.applications.items.length,2);assert.equal(first.applications.hasMore,true);assert.equal(second.applications.hasMore,false);assert.ok(!second.applications.items.some(x=>first.applications.items.some(y=>x.id===y.id)));
 await f.store.setSetting('job_lifecycle_'+job.id,{state:'deleted',revision:1});assert.equal((await searchWorkspace(f.store,RECRUITER,params('Engineer'))).jobs.total,0);
 }finally{f.database.close()}});

test('numeric search survives invalid JSON, scalar JSON and mixed legacy answers while finding valid phone items',async()=>{const f=createStore();try{const job=await f.store.saveJob(jobInput());const values=['not json',JSON.stringify('legacy text'),JSON.stringify(['legacy answer text',42,null,true]),JSON.stringify({legacy:'text'}),JSON.stringify(['legacy text',{path:'_systemfield_phone',value:'+1 555 123 4567'},null,7])];let match='';for(const [i,value]of values.entries()){const app=await f.store.acceptApplication(applicationInput(job.id));await f.store.stmt('UPDATE hub_applications SET answers_json=? WHERE id=?',value,app.id).run();if(i===values.length-1)match=app.id}const result=await searchWorkspace(f.store,RECRUITER,params('555123'));assert.equal(result.applications.total,1);assert.equal(result.applications.items[0].id,match)}finally{f.database.close()}});
test('common Latam names are searchable across case and composed accents without interpreting glob metacharacters',async()=>{const f=createStore();try{const job=await f.store.saveJob(jobInput());for(const name of ['José María MUÑOZ','João André Gonçalves','Literal [abc]?*_%']){const input=applicationInput(job.id);input.fieldSubmissions[0].value=name;await f.store.acceptApplication(input)}for(const q of ['jose maria munoz','JOSÉ MARÍA MUÑOZ','MuNoZ','joao andre','GONCALVES'])assert.equal((await searchWorkspace(f.store,RECRUITER,params(q))).applications.total,1,q);for(const q of ['[abc]','?*','_%'])assert.equal((await searchWorkspace(f.store,RECRUITER,params(q))).applications.total,1,q);assert.equal((await searchWorkspace(f.store,RECRUITER,params('[xyz]'))).applications.total,0)}finally{f.database.close()}});
