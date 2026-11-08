import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceDifferences} from '../../lib/hub/claim-history';
function snap(years:number,title='How many years managing Google Ads?',createdAt=0,path='q1'){
 return {fields:[{title,type:'Number' as const,path,required:true}],answers:[{path,value:years}],createdAt};
}
test('compares identical questions even when job field IDs differ',()=>{
 assert.equal(experienceDifferences(snap(3),snap(8,undefined,0,'q5')).length,1);
});
test('does not flag normal progression, different skills or salary',()=>{
 assert.deepEqual(experienceDifferences(snap(2),snap(5,undefined,3*365.25*86400000)),[]);
 assert.deepEqual(experienceDifferences(snap(2),snap(8,'How many years managing teams?')),[]);
 assert.deepEqual(experienceDifferences(snap(2000,'Expected salary'),snap(4000,'Expected salary')),[]);
});
