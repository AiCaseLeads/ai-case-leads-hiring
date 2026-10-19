import assert from 'node:assert/strict';
import {test} from 'node:test';
import {englishLevels,englishProficiencyField,englishProficiencyPath,acceptedEnglishLevels,englishMinimum} from '../../lib/english-proficiency';
import {evaluateRequirements,validateJob,jobInput as jobSchema} from '../../lib/hub/validation';
import {validateAnswers} from '../../lib/hiring/validation';
import {createStore,jobInput,applicationInput} from './fixtures';
import type {Rule} from '../../lib/hub/types';
const rule=(minimum:string):Rule=>({fieldPath:englishProficiencyPath,operator:'in',value:acceptedEnglishLevels(minimum),enabled:true,reason:`Minimum ${minimum}`});
test('all 36 CEFR threshold combinations use ordered levels with C2 highest',()=>{
 for(const [minimumIndex,minimum] of englishLevels.entries()){
  assert.equal(englishMinimum(acceptedEnglishLevels(minimum)),minimum);
  for(const [answerIndex,answer] of englishLevels.entries())assert.equal(evaluateRequirements([rule(minimum)],[{path:englishProficiencyPath,value:answer}],[englishProficiencyField()]).qualification,answerIndex>=minimumIndex?'pass':'fail',`${answer} against ${minimum}`);
 }
 assert.deepEqual(acceptedEnglishLevels('unknown'),[]);assert.equal(englishMinimum(['A1','C2']),'');
});
test('English preset requires one canonical public answer and rejects missing or invented levels',()=>{
 const field=englishProficiencyField();assert.equal(field.required,true);assert.deepEqual(field.options?.map(o=>o.value),englishLevels);
 for(const value of ['', 'C3','Fluent', ['B2']]){const input=applicationInput('test');input.fieldSubmissions=[{path:englishProficiencyPath,value}];assert.throws(()=>validateAnswers(input,[field]));}
 const empty=applicationInput('test');empty.fieldSubmissions=[];assert.throws(()=>validateAnswers(empty,[field]));
 for(const value of englishLevels){const input=applicationInput('test');input.fieldSubmissions=[{path:englishProficiencyPath,value}];assert.doesNotThrow(()=>validateAnswers(input,[field]));}
});
test('saved minimum remains B2 and screening does not enable existing disabled rejection',async()=>{
 const{store,database}=createStore();try{const input=jobInput();input.fields.push(englishProficiencyField());input.rules=[rule('B2')];input.autoReject=false;validateJob(jobSchema.parse(input));const saved=await store.saveJob(input);assert.equal(saved.autoReject,false);assert.deepEqual(saved.rules[0].value,['B2','C1','C2']);const answer=applicationInput(saved.id);answer.fieldSubmissions.push({path:englishProficiencyPath,value:'B1'});const{id}=await store.acceptApplication(answer);const detail=await store.getApplication(id);assert.equal(detail?.qualification,'fail');assert.equal(detail?.stage,'Application Review');}finally{database.close();}
});
