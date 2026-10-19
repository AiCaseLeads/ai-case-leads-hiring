import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {readableMatchExplanation} from '../../lib/hub/match-display';
test('turns escaped answer evidence into readable text without changing the answer',()=>{
 assert.equal(readableMatchExplanation(String.raw`\"question\":\"Years of experience?\",\"answer\":3 — candidate answered 3 years.`),'Years of experience? Answer: 3 — candidate answered 3 years.');
});
test('preserves uncertainty, currency and ordinary explanations',()=>{
 assert.equal(readableMatchExplanation(String.raw`Managed $1.79K\nNo evidence of Microsoft Ads.`),'Managed $1.79K No evidence of Microsoft Ads.');
 assert.equal(readableMatchExplanation('Experience is not verified.'),'Experience is not verified.');
});
