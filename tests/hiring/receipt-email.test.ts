import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applicationReceipt} from '../../lib/hiring/receipt-email';
test('receipt identifies the job, review window and both possible outcomes',()=>{
 const body=applicationReceipt('Test Applicant','Creative Strategist');
 for(const text of ['Test Applicant','Creative Strategist','received successfully','3–5 business days','moving forward','different direction','Please do not reply','https://jobs.aicaseleads.com/help']) assert.ok(body.includes(text));
});
test('already-decided applications are not told they are still awaiting review',()=>{
 const body=applicationReceipt('Test Applicant','Creative Strategist',true);
 assert.ok(body.includes('separate email with the outcome'));
 assert.ok(!body.includes('awaiting review'));
 assert.ok(!body.includes('3–5 business days'));
});
