import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationPurpose} from '../../lib/hub/communication-purpose';
import {createStore,jobInput,applicationInput} from './fixtures';
test('purpose uses durable scoped task identity and never a subject guess',()=>{
 for(const [suffix,label] of [['confirmation','Acknowledgment email'],['rejection:2','Rejection email'],['assessment:id:invitation:3','Assessment invitation'],['interview:id:invitation:2','Interview invitation'],['reminder:id:2:24h','Interview reminder'],['manual:id','Recruiter email']])assert.equal(communicationPurpose(`gmail:app:${suffix}`,'app'),label);
 assert.equal(communicationPurpose('gmail:other:confirmation','app'),'Email');
 assert.equal(communicationPurpose('gmail:app:unexpected','app'),'Email');
});
test('application detail exposes acknowledgment purpose even with a customized subject',async()=>{
 const {store,database}=createStore();try{const job=await store.saveJob(jobInput());const app=await store.acceptApplication(applicationInput(job.id));database.prepare("UPDATE hub_communications SET subject='Custom subject' WHERE application_id=?").run(app.id);const detail=await store.getApplication(app.id);assert.equal(detail.communications[0].purpose,'Acknowledgment email');assert.equal(detail.communications[0].subject,'Custom subject');}finally{database.close();}
});

test('legacy messages without task identity remain readable',()=>{assert.equal(communicationPurpose(null,'app'),'Email');assert.equal(communicationPurpose(undefined,'app'),'Email');});
