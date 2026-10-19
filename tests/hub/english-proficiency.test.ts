import test from 'node:test';
import assert from 'node:assert/strict';
import {englishProficiencyField,englishProficiencyPath,englishLevels,acceptedEnglishLevels} from '../../lib/english-proficiency';
import {jobInput as schema,validateJob,evaluateRequirements} from '../../lib/hub/validation';
import {jobInput} from './fixtures';
import type {Rule} from '../../lib/hub/types';
const rule=(value:unknown=acceptedEnglishLevels('B2'),operator:Rule['operator']='in'):Rule=>({fieldPath:englishProficiencyPath,operator,value:value as Rule['value'],enabled:true,reason:'Minimum English level not met.'});
function posting(){const input=jobInput();input.fields.push(englishProficiencyField());return input;}
test('every CEFR minimum accepts exactly that level and higher without treating missing answers as failure',()=>{
 for(const minimum of englishLevels){const input=posting();input.rules=[rule(acceptedEnglishLevels(minimum))];input.autoReject=true;assert.doesNotThrow(()=>validateJob(schema.parse(input)));
 for(const answer of englishLevels)assert.equal(evaluateRequirements(input.rules,[{path:englishProficiencyPath,value:answer}],input.fields).qualification,englishLevels.indexOf(answer)>=englishLevels.indexOf(minimum)?'pass':'fail');
 assert.equal(evaluateRequirements(input.rules,[],input.fields).qualification,'review');
 }
 const input=posting();assert.doesNotThrow(()=>validateJob(schema.parse(input)));
});
test('English screening rejects arbitrary, duplicate, gapped, empty or inverted requirements',()=>{
 for(const value of [[],['C1'],['B2','C2'],['C2','C2'],['native'],['A1','C2'],'B2']){const input=posting();input.rules=[rule(value)];assert.throws(()=>validateJob(schema.parse(input)));}
 for(const operator of ['not_in','equals','contains','gte'] as const){const input=posting();input.rules=[rule(acceptedEnglishLevels('B2'),operator)];assert.throws(()=>validateJob(schema.parse(input)));}
 const input=posting();input.fields.at(-1)!.required=false;input.rules=[rule()];assert.throws(()=>validateJob(schema.parse(input)));input.rules[0].enabled=false;assert.doesNotThrow(()=>validateJob(schema.parse(input)));
});
test('English preset cannot be replaced with incomplete, reordered, relabeled or wrong-type answers',()=>{
 for(const change of ['missing','order','label','type']){const input=posting(),field=input.fields.at(-1)!;if(change==='missing')field.options!.pop();if(change==='order')field.options!.reverse();if(change==='label')field.options![0].label='Advanced';if(change==='type')field.type='String';assert.throws(()=>validateJob(schema.parse(input)));}
});
