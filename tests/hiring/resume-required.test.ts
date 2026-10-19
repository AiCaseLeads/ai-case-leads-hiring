import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withRequiredResume,resumePath} from '../../lib/hiring/contact-fields';
import {acceptLocalApplication} from '../../lib/hiring/local';
import {sha256} from '../../lib/hiring/crypto';
import {handleHubRequest} from '../../lib/hub/http';
import {jobInput,MANAGER} from '../hub/fixtures';
import {customDatabase,openSyntheticRole} from '../custom-fixture';
import {validateAnswers,parseApplication} from '../../lib/hiring/validation';
import {validateJob} from '../../lib/hub/validation';
const session='a'.repeat(64);
async function upload(f:ReturnType<typeof customDatabase>,jobId:string,overrides:{session?:string;expired?:boolean;uploaded?:boolean;field?:string}={}){
 const handle=crypto.randomUUID(),id=await sha256(handle),now=Date.now();
 f.database.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,expires_at,session_hash) VALUES(?,?,?,'resume.pdf','application/pdf',12,?,?,?,?)").run(id,jobId,overrides.field||resumePath,id,overrides.uploaded===false?null:now,overrides.expired?now-1:now+60000,await sha256(overrides.session||session));
 return handle;
}
test('canonical resume cannot be removed, renamed, made optional or converted to a text answer',()=>{
 for(const fields of [[],[{path:resumePath,title:'Anything',type:'String' as const,required:false}]]){
  const normalized=withRequiredResume(fields);assert.deepEqual(normalized.find(f=>f.path===resumePath),{path:resumePath,title:'Résumé / CV',type:'File',required:true});assert.deepEqual(withRequiredResume(normalized),normalized);
 }
});
test('legacy public intake requires a current owned uploaded resume and retries accepted receipts safely',async()=>{
 const f=customDatabase();try{
  const job=await openSyntheticRole(f.store),definition=await f.store.jobDefinition(job.id);
  assert.equal(definition.fields.find(v=>v.path===resumePath)?.required,true);
  assert.equal((await f.store.getJob(job.id)).fields.some(v=>v.path===resumePath),false,'Legacy stored job stays unchanged');
  const input={jobPostingId:job.id,submissionKey:crypto.randomUUID(),formVersion:job.formVersion,fieldSubmissions:[{path:'_systemfield_name',value:'Synthetic Test'},{path:'_systemfield_email',value:'synthetic@example.invalid'},{path:'_systemfield_phone',value:'+13055550123'},{path:'linkedin_profile',value:'https://www.linkedin.com/in/synthetic'}]};
  await assert.rejects(()=>acceptLocalApplication(f.db,input,session,true,true),{code:'invalid_application'});
  for(const overrides of [{session:'b'.repeat(64)},{expired:true},{uploaded:false},{field:'portfolio'}]){
   const handle=await upload(f,job.id,overrides);
   await assert.rejects(()=>acceptLocalApplication(f.db,{...input,fieldSubmissions:[...input.fieldSubmissions,{path:resumePath,value:handle}]},session,true,true),{code:'invalid_upload'});
  }
  const handle=await upload(f,job.id),valid={...input,fieldSubmissions:[...input.fieldSubmissions,{path:resumePath,value:handle}]};
  await assert.rejects(()=>acceptLocalApplication(f.db,{...valid,fieldSubmissions:valid.fieldSubmissions.filter(answer=>answer.path!=='linkedin_profile')},session,true,true),{code:'invalid_application'});
  assert.ok((await Promise.all(Array.from({length:20},()=>acceptLocalApplication(f.db,valid,session,true,true)))).every(result=>result.status==='accepted'));
  assert.equal((await acceptLocalApplication(f.db,valid,session,true,true)).status,'accepted');
  assert.equal(f.database.prepare('SELECT count(*) n FROM hub_applications').get()!.n,1);
  await assert.rejects(()=>acceptLocalApplication(f.db,{...valid,submissionKey:crypto.randomUUID()},session,true,true),{code:'invalid_upload'});
 }finally{f.database.close();}
});
test('authenticated job saves normalize the required resume on create and patch',async()=>{
 const f=customDatabase();try{
  const request=(body:unknown,method='POST')=>new Request('https://jobs.example.invalid/api/hub/jobs',{method,headers:{Origin:'https://jobs.example.invalid','Content-Type':'application/json'},body:JSON.stringify(body)});
  const created=await handleHubRequest(request({...jobInput(),fields:jobInput().fields.filter(f=>f.path!==resumePath)}),['jobs'],MANAGER,f.store);assert.equal(created.status,200);
  const job=(await created.json() as {data:import('../../lib/hub/types').HubJob}).data;
  assert.equal(job.fields.find((v:{path:string})=>v.path===resumePath)?.required,true);
  const response=await handleHubRequest(request({fields:[...jobInput().fields.filter(f=>f.path!==resumePath),{path:resumePath,title:'Text only',type:'String',required:false}],formVersion:job.formVersion},'PATCH'),['jobs',job.id],MANAGER,f.store);assert.equal(response.status,200);
  const updated=(await response.json() as {data:import('../../lib/hub/types').HubJob}).data;assert.deepEqual(updated.fields.find((v:{path:string})=>v.path===resumePath),{path:resumePath,title:'Résumé / CV',type:'File',required:true});
 }finally{f.database.close();}
});
test('numeric answers accept decimals while USD rejects fractional cents and string bypasses',()=>{
 const answer=(value:unknown)=>({jobPostingId:'test',submissionKey:'test',fieldSubmissions:[{path:'amount',value}]}) as Parameters<typeof validateAnswers>[0];
 const field={path:'amount',title:'Salary',type:'Number' as const,required:true,numberFormat:'currency' as const,currency:'USD' as const};
 for(const value of [0,1234.56,50000])assert.doesNotThrow(()=>validateAnswers(answer(value),[field]));
 for(const value of [1.234,0.000000001,1.000000001,'1,234.56',NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>validateAnswers(answer(value),[field]),{code:'invalid_application'});
 assert.doesNotThrow(()=>validateAnswers(answer(2.5),[{...field,numberFormat:'number',currency:undefined}]));
 assert.throws(()=>validateJob({...jobInput(),fields:[{...field,type:'String'}]}),{code:'invalid_job'});
 assert.throws(()=>validateJob({...jobInput(),fields:[...jobInput().fields,field],rules:[{fieldPath:'amount',operator:'gte',value:1.234,enabled:true,reason:'Minimum pay'}]}),{code:'invalid_rule'});
});

test('legacy 100-question forms have room for the fixed phone, resume and LinkedIn answers',()=>{
 const input={jobPostingId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fieldSubmissions:Array.from({length:103},(_,i)=>({path:'field_'+i,value:'synthetic'}))};
 assert.equal(parseApplication(input).fieldSubmissions.length,103);
 assert.throws(()=>parseApplication({...input,fieldSubmissions:[...input.fieldSubmissions,{path:'extra',value:'synthetic'}]}),{code:'invalid_request'});
});
