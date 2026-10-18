import assert from "node:assert/strict";
import {test} from "node:test";
import {countryOptions,countryResidenceField,residencePath} from "../../lib/countries";
import {jobInput as jobSchema,validateJob,evaluateRequirements} from "../../lib/hub/validation";
import {validateAnswers} from "../../lib/hiring/validation";
import {createStore,jobInput,applicationInput} from "./fixtures";
import type {Rule} from "../../lib/hub/types";
const rule=(operator:Rule["operator"]="in",value:string[]=["ES","US"]):Rule=>({fieldPath:residencePath,operator,value,enabled:true,reason:"Residence outside eligible countries."});
function posting(){const input=jobInput();input.fields.push(countryResidenceField());return input;}
test("full country preset saves and retains all countries when screening permits only two",async()=>{
 assert.equal(countryOptions.length,249);assert.equal(new Set(countryOptions.map(option=>option.value)).size,249);
 const input=posting();input.rules=[rule()];input.autoReject=true;
 validateJob(jobSchema.parse(input));const{store,database}=createStore();try{
 const saved=await store.saveJob(input);assert.equal(saved.fields.find(field=>field.path===residencePath)?.options?.length,249);
 for(const [country,qualification,stage] of [["ES","pass","Application Review"],["CO","fail","Rejected"]]){
 const application=applicationInput(saved.id);application.fieldSubmissions.push({path:residencePath,value:country});const{id}=await store.acceptApplication(application);const record=await store.getApplication(id);assert.equal(record?.qualification,qualification);assert.equal(record?.stage,stage);
 }
 }finally{database.close();}
});
test("any country defaults to no screening and exclusion uses valid exact country codes",()=>{
 const field=countryResidenceField();assert.equal(evaluateRequirements([], [{path:residencePath,value:"CO"}],[field]).qualification,"review");
 assert.equal(evaluateRequirements([rule("not_in",["US"])],[{path:residencePath,value:"CO"}],[field]).qualification,"pass");
 assert.equal(evaluateRequirements([rule("not_in",["US"])],[{path:residencePath,value:"US"}],[field]).qualification,"fail");
 assert.equal(evaluateRequirements([rule()],[],[field]).qualification,"review");
});
test("invalid/empty/duplicate country rules and incomplete country catalogs cannot save",()=>{
 for(const values of [[],["ZZ"],["US","US"]]){const input=posting();input.rules=[rule("in",values)];assert.throws(()=>validateJob(jobSchema.parse(input)));}
 const optional=posting();optional.fields.at(-1)!.required=false;optional.rules=[rule()];assert.throws(()=>validateJob(jobSchema.parse(optional)));
 const partial=posting();partial.fields.at(-1)!.options=countryOptions.slice(0,5);assert.throws(()=>validateJob(jobSchema.parse(partial)));
 const foreign=posting();foreign.rules=[{...rule(),fieldPath:"experience"}];assert.throws(()=>validateJob(jobSchema.parse(foreign)));
});
test("applicant country submission rejects arbitrary text and missing required residence",()=>{
 for(const value of ["Spain","ZZ",""]){const input=applicationInput("synthetic");input.fieldSubmissions=[{path:residencePath,value}];assert.throws(()=>validateAnswers(input,[countryResidenceField()]));}
 const input=applicationInput("synthetic");input.fieldSubmissions=[{path:residencePath,value:"ES"}];assert.doesNotThrow(()=>validateAnswers(input,[countryResidenceField()]));
});
