import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withRequiredApplicationFields,withRequiredContacts,setSystemFieldRequired,resumePath,linkedInPath} from '../../lib/hiring/contact-fields';
import {validateAnswers} from '../../lib/hiring/validation';
import {handleHubRequest} from '../../lib/hub/http';
import {jobInput,MANAGER} from '../hub/fixtures';
import {customDatabase} from '../custom-fixture';
import type {ApplicationField} from '../../lib/hiring/types';

const find=(fields:ApplicationField[],path:string)=>fields.find(field=>field.path===path)!;
const base=()=>withRequiredApplicationFields(withRequiredContacts([]));
const contacts=[{path:'_systemfield_name',value:'Synthetic Test'},{path:'_systemfield_last_name',value:'Applicant'},{path:'_systemfield_email',value:'synthetic@example.invalid'},{path:'_systemfield_phone',value:'+13055550123'}];

test('LinkedIn and résumé stay required by default and for legacy optional fields',()=>{
 const defaults=withRequiredApplicationFields([]);
 assert.equal(find(defaults,linkedInPath).required,true);assert.equal(find(defaults,resumePath).required,true);
 const legacy=withRequiredApplicationFields([{path:resumePath,title:'CV',type:'File',required:false},{path:linkedInPath,title:'LinkedIn',type:'SocialLink',required:false}]);
 assert.equal(find(legacy,linkedInPath).required,true);assert.equal(find(legacy,resumePath).required,true);
 assert.equal(find(legacy,resumePath).ownerOptional,undefined);
});

test('a job owner can make LinkedIn and résumé optional and turn them back on',()=>{
 let fields=base();
 fields=setSystemFieldRequired(setSystemFieldRequired(fields,'linkedin',false),'resume',false);
 const optional=withRequiredApplicationFields(fields);
 assert.deepEqual(find(optional,resumePath),{path:resumePath,title:'Résumé / CV',type:'File',required:false,ownerOptional:true});
 assert.equal(find(optional,linkedInPath).required,false);assert.equal(find(optional,linkedInPath).ownerOptional,true);
 assert.deepEqual(withRequiredApplicationFields(optional),optional,'normalization is stable');
 assert.doesNotThrow(()=>validateAnswers({jobPostingId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fieldSubmissions:contacts},optional));
 const restored=withRequiredApplicationFields(setSystemFieldRequired(setSystemFieldRequired(optional,'linkedin',true),'resume',true));
 assert.deepEqual(find(restored,resumePath),{path:resumePath,title:'Résumé / CV',type:'File',required:true});
 assert.equal(find(restored,linkedInPath).ownerOptional,undefined);
 assert.throws(()=>validateAnswers({jobPostingId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fieldSubmissions:contacts},restored),{code:'invalid_application'});
});

test('optional LinkedIn still checks a link when an applicant gives one',()=>{
 const fields=withRequiredApplicationFields(setSystemFieldRequired(base(),'linkedin',false));
 assert.throws(()=>validateAnswers({jobPostingId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fieldSubmissions:[...contacts,{path:resumePath,value:'handle'},{path:linkedInPath,value:'https://example.com/me'}]},fields),{code:'invalid_application'});
});

test('job saves keep the owner choice and reject the flag on other questions',async()=>{
 const f=customDatabase();try{
  const request=(body:unknown,method='POST')=>new Request('https://jobs.example.invalid/api/hub/jobs',{method,headers:{Origin:'https://jobs.example.invalid','Content-Type':'application/json'},body:JSON.stringify(body)});
  const created=await handleHubRequest(request(jobInput()),['jobs'],MANAGER,f.store);assert.equal(created.status,200);
  const job=(await created.json() as {data:import('../../lib/hub/types').HubJob}).data;
  const optionalFields=setSystemFieldRequired(setSystemFieldRequired(job.fields,'resume',false),'linkedin',false);
  const patched=await handleHubRequest(request({fields:optionalFields,formVersion:job.formVersion},'PATCH'),['jobs',job.id],MANAGER,f.store);assert.equal(patched.status,200);
  const updated=(await patched.json() as {data:import('../../lib/hub/types').HubJob}).data;
  assert.equal(find(updated.fields,resumePath).required,false);assert.equal(find(updated.fields,linkedInPath).required,false);
  const definition=await f.store.jobDefinition(job.id);
  assert.equal(find(definition.fields,resumePath).required,false);assert.equal(find(definition.fields,linkedInPath).required,false);
  const other=updated.fields.find(field=>!field.path.startsWith('_systemfield')&&field.path!==linkedInPath)!;
  const misuse=updated.fields.map(field=>field.path===other.path?{...field,required:false,ownerOptional:true}:field);
  const rejected=await handleHubRequest(request({fields:misuse,formVersion:updated.formVersion},'PATCH'),['jobs',job.id],MANAGER,f.store);
  assert.equal(rejected.status,422);
 }finally{f.database.close();}
});
