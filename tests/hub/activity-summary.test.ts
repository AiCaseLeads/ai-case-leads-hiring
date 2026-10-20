import test from 'node:test';
import assert from 'node:assert/strict';
import {activitySummary,communicationSummary} from '../../components/hub/activity-summary';
test('AI history is compact evidence-score prose, not raw model JSON or a hiring decision',()=>{
 const summary=activitySummary({type:'ai_match',text:JSON.stringify({score:88,model:'model',review:{criteria:[{explanation:'Long private source evidence'}]}})});
 assert.deepEqual(summary,{title:'AI review completed',description:'Job match: 88 / 100.',review:true});
 for(const text of ['broken','{"score":null}','{"score":999}','[]'])assert.equal(activitySummary({type:'ai_match',text}).title,'AI review needs attention');
});
test('known history has readable labels and unknown machine records never leak JSON',()=>{
 assert.deepEqual(activitySummary({type:'email_recovery',text:'Previously queued email released.'}),{title:'Email retry queued',description:'Previously queued email released.'});
 assert.equal(activitySummary({type:'note',text:'Follow up tomorrow.'}).description,'Follow up tomorrow.');
 assert.equal(activitySummary({type:'new_machine_event',text:'{"debug":"internal"}'}).description,'Details recorded in the application.');
});
test('communication queued, sent, delivered, failed and uncertain remain distinct',()=>{
 assert.equal(communicationSummary('pending').label,'Queued');
 assert.equal(communicationSummary('sent').label,'Sent');assert.match(communicationSummary('sent').explanation,/not confirmed/);
 assert.equal(communicationSummary('sent_external').label,'Sent from email');
 assert.equal(communicationSummary('delivered').label,'Delivered');
 assert.equal(communicationSummary('failed').label,'Failed');
 assert.match(communicationSummary('uncertain').explanation,/Do not send a duplicate/);
 assert.equal(communicationSummary('cancelled').label,'Cancelled');
 assert.equal(communicationSummary('unknown').label,'Status unavailable');
});
