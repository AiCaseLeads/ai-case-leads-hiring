import assert from 'node:assert/strict';import {test} from 'node:test';
import {answerContactName} from '../../components/hub/application-answers';
import type {ApplicationDetail} from '../../components/hub/types';
test('canonical contacts combine names while legacy full names and custom name answers are preserved',()=>{
 const detail=(answers:ApplicationDetail['answers'],name='Legacy Full Name')=>({answers,name} as ApplicationDetail);
 assert.equal(answerContactName(detail([{path:'_systemfield_name',value:'Jordan'},{path:'_systemfield_last_name',value:'Simmons'}])),'Jordan Simmons');
 assert.equal(answerContactName(detail([{path:'_systemfield_name',value:'Jordan Simmons'},{path:'_systemfield_last_name',value:'Simmons'}])),'Jordan Simmons');
 assert.equal(answerContactName(detail([{path:'_systemfield_name',value:'Legacy Full Name'}])),'Legacy Full Name');
 assert.equal(answerContactName(detail([{path:'custom_name',value:'Different name answer'}])),'Legacy Full Name');
 assert.equal(answerContactName(detail([{path:'_systemfield_last_name',value:'Simmons'}],'')),'Simmons');
});
