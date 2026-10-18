import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStore,MANAGER,jobInput,applicationInput} from './fixtures';
import {handleJobDrafts} from '../../lib/job-setup/drafts';
import {handleJobSetup} from '../../lib/job-setup/http';
import {countryResidenceField,residencePath} from '../../lib/countries';
import {jobInput as jobSchema,validateJob} from '../../lib/hub/validation';
import {readableAnswers} from '../../lib/hub/exports';
import {applicationPdf} from '../../lib/pdf/application';
import {readablePdf} from '../pdf/readable';
import type {SetupCatalog} from '../../lib/job-setup/model';
const rule={fieldPath:residencePath,operator:'in' as const,value:['ES','US'],enabled:true,reason:'Location requirement'};
const req=(path:string,method:string,body?:unknown)=>new Request('https://jobs.example.invalid/api/'+path,{method,headers:{origin:'https://jobs.example.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const state=(values:string[])=>({title:'Country draft',description:'<p>Role</p>',location:null,fields:[countryResidenceField()],department:'',customSlug:null,assessment:'',rules:[{...rule,value:values}],autoReject:true,rejection:'',choice:'none',rubric:{name:'',criteria:[]},team:null,teamRevision:null,expectedBinding:null,step:1,creationId:crypto.randomUUID(),postingLabel:'Private draft',formVersion:null,startKind:'blank',sourceId:''});
test('private recovery preserves incomplete and complete country choices without enabling invalid publication',async()=>{
 const{store,database}=createStore();try{
 for(const [revision,values] of [[0,[]],[1,['ES','US']]] as const){
 const response=await handleJobDrafts(req('job-drafts','PUT',{key:'new:blank:',expectedRevision:revision,state:state([...values])}),MANAGER,store);assert.equal(response.status,200,await response.clone().text());
 const loaded=await handleJobDrafts(req('job-drafts?key=new%3Ablank%3A','GET'),MANAGER,store);const body=await loaded.json() as {data:{state:ReturnType<typeof state>}};assert.deepEqual(body.data.state.rules[0].value,values);assert.equal(body.data.state.fields[0].options?.length,249);
 }
 const invalid={...jobInput(),fields:[...jobInput().fields,countryResidenceField()],rules:[{...rule,value:[]}]};assert.throws(()=>validateJob(jobSchema.parse(invalid)));
 assert.equal((await store.listJobs()).length,0);
 }finally{database.close();}
});
test('country rules and labels survive template HTTP creation and duplicate job save',async()=>{
 const{store,database}=createStore();try{
 const original=await store.saveJob({...jobInput(),fields:[...jobInput().fields,countryResidenceField()],rules:[rule],autoReject:true});
 const response=await handleJobSetup(req('job-setup','PATCH',{action:'template',expectedRevision:0,sourceJobId:original.id,name:'Country template'}),MANAGER,store);assert.equal(response.status,200,await response.clone().text());
 const catalog=(await response.json() as {data:SetupCatalog}).data;const template=catalog.templates[0].job;assert.equal(template.autoReject,false);assert.deepEqual(template.rules[0].value,['ES','US']);assert.equal(template.fields.find(f=>f.path===residencePath)?.options?.length,249);
 const creationId=crypto.randomUUID();const saved=await handleJobSetup(req('job-setup','POST',{action:'save',creationId,job:{...template,slug:'country-copy'},location:{workModel:'remote',country:'International',city:''},expectedBinding:null,scorecard:null}),MANAGER,store);assert.equal(saved.status,200,await saved.clone().text());
 const copy=await store.getJob(creationId);assert.equal(copy.fields.find(f=>f.path===residencePath)?.options?.length,249);assert.deepEqual(copy.rules[0].value,['ES','US']);
 const input=applicationInput(original.id);input.fieldSubmissions.push({path:residencePath,value:'ES'});const app=await store.acceptApplication(input);const record=await store.exportRecord(app.id);assert.match(readableAnswers(record.answers,record.questions),/Country of residence: Spain/);const pdf=await readablePdf(await applicationPdf(await store.getApplication(app.id)));assert.match(pdf.text,/Spain/);assert.match(pdf.text,/Country of residence/);
 }finally{database.close();}
});
