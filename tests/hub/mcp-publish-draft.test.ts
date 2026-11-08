import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore, MANAGER, RECRUITER,applicationInput,jobInput} from './fixtures';
import {AGENT_SCOPES,authorizeAgent,issueAccess,updateAccessScopes} from '../../lib/agent-api/access';
import {draftJobs,publishJobs} from '../../lib/job-import/service';
import {evaluateRequirements,validateJob} from '../../lib/hub/validation';
const draft={title:'Media Buyer',description:'Manage paid campaigns and report on qualified leads.',questions:[]};
const request=(token:string)=>new Request('https://jobs.test/api/agent-jobs',{headers:{authorization:'Bearer '+token}});
test('scope failure names the missing scope only after authenticating; expiry and revocation have distinct errors',async()=>{const {store,database}=createStore();try{
 const issued=await issueAccess(store,'Claude Code',['jobs:read','jobs:draft','applicants:read','files:read'],'owner');
 await assert.rejects(authorizeAgent(store,request(issued.token),'jobs:publish'),{code:'agent_scope_required',message:'This connection lacks jobs:publish. Ask the owner to enable it in Settings → Integrations → Codex & Claude.'});
 await assert.rejects(authorizeAgent(store,request(issued.token.slice(0,-1)+'z'),'jobs:publish'),{code:'agent_unauthorized'});
 const key='agent_access_'+issued.id,raw=await store.setting<Record<string,unknown>>(key,{});
 await store.setSetting(key,{...raw,expiresAt:1});await assert.rejects(authorizeAgent(store,request(issued.token),'jobs:read'),/expired/);
 await store.setSetting(key,{...raw,revoked:true});await assert.rejects(authorizeAgent(store,request(issued.token),'jobs:read'),/revoked/);
 }finally{database.close()}});
test('owner enables all five scopes and removes expiry without changing token or restoring revoked duplicate',async()=>{const {store,database}=createStore();try{
 const issued=await issueAccess(store,'Claude Code (Collins Mac)',['jobs:read','jobs:draft'],'owner',false);
 const duplicate=await issueAccess(store,'Claude Code (Collins Mac) · applicant review',['applicants:read','files:read'],'owner');
 const key='agent_access_'+issued.id,before=await store.setting<Record<string,unknown>>(key,{}),duplicateKey='agent_access_'+duplicate.id;
 await store.setSetting(duplicateKey,{...await store.setting(duplicateKey,{}),revoked:true});
 await assert.rejects(updateAccessScopes(store,{id:issued.id,scopes:AGENT_SCOPES,noExpiry:true},RECRUITER),{code:'owner_access_required'});
 const result=await updateAccessScopes(store,{id:issued.id,scopes:AGENT_SCOPES,noExpiry:true},MANAGER);
 assert.equal(result.expiresAt,null);assert.deepEqual(result.scopes,AGENT_SCOPES);assert.equal((await store.setting<Record<string,unknown>>(key,{})).hash,before.hash);
 for(const scope of AGENT_SCOPES)await authorizeAgent(store,request(issued.token),scope);
 await assert.rejects(authorizeAgent(store,request(duplicate.token),'applicants:read'),/revoked/);
 assert.ok(!JSON.stringify(result).includes(issued.token));
 const audit=database.prepare("SELECT after_json FROM hub_audit WHERE type='agent_access_scopes'").get()!;assert.equal(JSON.parse(String(audit.after_json)).expiresAt,null);
 }finally{database.close()}});
test('new connections default to no expiry; legacy deadlines still expire and cannot be revived by edit',async()=>{const {store,database}=createStore();try{
 const access=await issueAccess(store,'permanent',AGENT_SCOPES,'owner');assert.equal(access.expiresAt,null);
 const old=await issueAccess(store,'legacy',['jobs:read'],'owner',false);assert.ok(old.expiresAt!>Date.now());
 await store.setSetting('agent_access_'+old.id,{...await store.setting('agent_access_'+old.id,{}),expiresAt:1});
 await assert.rejects(updateAccessScopes(store,{id:old.id,scopes:AGENT_SCOPES,noExpiry:true},MANAGER),{code:'access_not_editable'});
 }finally{database.close()}});
test('single-country mode creates one unchanged title and full residence field with canonical in rule',async()=>{const jobs=draftJobs(draft,['USA','IN','Pakistan','us'],'single');assert.equal(jobs.length,1);assert.equal(jobs[0].title,draft.title);assert.equal(jobs[0].slug,'media-buyer');const field=jobs[0].fields.find(f=>f.path==='country_of_residence')!;assert.equal(field.required,true);assert.ok(field.options!.length>200);assert.deepEqual(jobs[0].rules[0].value,['US','IN','PK']);validateJob(jobs[0]);assert.throws(()=>draftJobs(draft,['Atlantis'],'single'),{code:'invalid_country'});assert.throws(()=>draftJobs(draft,[],'single'));assert.equal(draftJobs(draft,['India','USA']).length,2);});
test('select options and not_equals rules survive drafting and publishing, rejecting excluded scalar or multi answers',async()=>{const d={...draft,questions:[{title:'Primary result?',type:'ValueSelect',required:false,options:[{value:'leads',label:'Leads'},{value:'views',label:'Views'}],rules:[{operator:'not_equals',value:'views'}]},{title:'Experience?',type:'MultiValueSelect',options:[{value:'legal',label:'Legal'},{value:'none',label:'None'}],rules:[{operator:'not_equals',value:'none'}]}]};const {store,database}=createStore();try{
 const [job]=draftJobs(d,['US','IN'],'single');assert.equal(job.fields.find(f=>f.path==='question_1')!.required,true);assert.equal(job.rules.filter(r=>r.operator==='not_equals').length,2);
 const answers=[{path:'country_of_residence',value:'US'},{path:'question_1',value:'leads'},{path:'question_2',value:['legal']}];assert.equal(evaluateRequirements(job.rules,answers,job.fields).qualification,'pass');for(const bad of [{path:'question_1',value:'views'},{path:'question_2',value:['legal','none']}])assert.equal(evaluateRequirements(job.rules,answers.map(a=>a.path===bad.path?bad:a),job.fields).qualification,'fail');
 const [saved]=await publishJobs(store,[{...job,status:'open'}],true);assert.equal(saved.status,'open');assert.deepEqual(saved.fields.find(f=>f.path==='question_2')!.options,d.questions[1].options);
 }finally{database.close()}});
test('select drafting refuses missing duplicate options, unknown rule values and unsupported combinations',()=>{
 const q={title:'Result?',type:'ValueSelect',options:[{value:'yes',label:'Yes'}],rules:[{operator:'not_equals',value:'no'}]};
 for(const value of [{...q,options:undefined},{...q,options:[{value:'yes',label:'Yes'},{value:'yes',label:'Duplicate'}]},{...q},{...q,rules:[{operator:'contains',value:'yes'}]},{...q,type:'String'}])assert.throws(()=>draftJobs({...draft,questions:[value]},['US'],'single'));
});

test('explicit replacement retains existing applicants and address, updates exact fields/rules and is idempotent',async()=>{const {store,database}=createStore();try{
 const job=jobInput();const first=await store.saveJob(job);const app=await store.acceptApplication(applicationInput(first.id));
 const changed={...job,title:'Exact updated title',descriptionHtml:'<p>Updated wording exactly as supplied.</p>'};
 await assert.rejects(publishJobs(store,[changed],true),{code:'job_slug_exists'});
 await assert.rejects(publishJobs(store,[changed],false,true),{code:'publish_confirmation_required'});
 const [saved]=await publishJobs(store,[changed],true,true);assert.equal(saved.id,first.id);assert.equal(saved.title,changed.title);assert.equal(saved.slug,first.slug);assert.equal(saved.descriptionHtml,changed.descriptionHtml);assert.deepEqual(saved.rules,changed.rules);assert.equal((await store.getApplication(app.id)).jobId,first.id);
 const [again]=await publishJobs(store,[changed],true,true);assert.equal(again.formVersion,saved.formVersion);assert.equal((await store.listJobs()).length,1);
 }finally{database.close()}});
