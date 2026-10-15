import assert from 'node:assert/strict';
import { test } from 'node:test';
import { websiteLinkError } from '../../lib/hiring/website-links';
import { validateAnswers } from '../../lib/hiring/validation';
import type { ApplicationField, ApplicationInput } from '../../lib/hiring/types';
const field: ApplicationField = {path:'portfolio',title:'Portfolio',type:'Url',required:false};
const input = (value: unknown): ApplicationInput => ({jobPostingId:'test',submissionKey:'test',fieldSubmissions:[{path:'portfolio',value}]}) as ApplicationInput;
test('website answers accept full HTTPS links and reject malformed or unsafe schemes',()=>{
 for(const value of ['https://example.com/portfolio','https://work.example.co.uk/?project=1#work','https://例え.jp/作品']) assert.equal(websiteLinkError(value,field),null,value);
 for(const value of ['KKK','https://KKK','www.example.com','http://example.com','javascript:alert(1)','https:example.com','https:///example.com','https://user:password@example.com','https://example.com/my work','https://example.com\\@evil.com','https://example..com']) {
  assert.ok(websiteLinkError(value,field),value);
  assert.throws(()=>validateAnswers(input(value),[field]),{code:'invalid_application'});
 }
 validateAnswers(input(''),[field]);
 validateAnswers(input('https://example.com/portfolio'),[field]);
 assert.throws(()=>validateAnswers(input(''),[{...field,required:true}]),{code:'invalid_application'});
});
test('LinkedIn questions require LinkedIn HTTPS hosts, not lookalike domains',()=>{
 const linkedin={path:'linkedin_profile',title:'LinkedIn profile'};
 for(const value of ['https://linkedin.com/in/person','https://www.linkedin.com/in/person','https://es.linkedin.com/in/person']) assert.equal(websiteLinkError(value,linkedin),null);
 for(const value of ['https://linkedin.com.evil.com/in/person','https://notlinkedin.com','https://example.com','http://linkedin.com/in/person']) assert.ok(websiteLinkError(value,linkedin));
});
