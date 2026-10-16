import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNoReplyDomain } from '../../lib/email/dns';
const domain='notify.aicaseleads.com.';
test('only an exact isolated Null MX authorizes no-reply delivery, with no provider secrets sent to DNS',async()=>{
 let calls=0;
 await verifyNoReplyDomain(async(input,init)=>{calls++;assert.equal(new URL(String(input)).searchParams.get('name'),'notify.aicaseleads.com');assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json({Status:0,Answer:[{name:domain,type:15,data:'0 .'}]});});
 assert.equal(calls,1);
});
test('missing, mixed, foreign, ordinary MX and DNS failures hold automatic sending',async()=>{
 for(const data of [{Status:3},{Status:0,Answer:[]},{Status:0,Answer:[{name:domain,type:15,data:'10 aspmx.l.google.com.'}]},{Status:0,Answer:[{name:domain,type:15,data:'0 .'},{name:domain,type:15,data:'10 other.example.'}]},{Status:0,Answer:[{name:'aicaseleads.com.',type:15,data:'0 .'}]}])await assert.rejects(verifyNoReplyDomain(async()=>Response.json(data)),{code:'transactional_mail_reply_domain_not_verified',uncertain:false});
 await assert.rejects(verifyNoReplyDomain(async()=>{throw new Error('network down');}),{code:'transactional_mail_dns_check_failed'});
});

test('an expired processor deadline starts no DNS request; temporary SERVFAIL remains retryable',async()=>{
 let calls=0;await assert.rejects(verifyNoReplyDomain(async()=>{calls++;return Response.json({Status:0});},1000,999),{code:'transactional_mail_dns_check_failed'});assert.equal(calls,0);
 await assert.rejects(verifyNoReplyDomain(async()=>Response.json({Status:2})),{code:'transactional_mail_dns_check_failed'});
});

test('malformed DNS answer arrays remain retryable rather than throwing a raw TypeError',async()=>{for(const Answer of [{},[null]])await assert.rejects(verifyNoReplyDomain(async()=>Response.json({Status:0,Answer})),{code:'transactional_mail_dns_check_failed'});});
