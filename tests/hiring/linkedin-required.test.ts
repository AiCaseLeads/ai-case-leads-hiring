import {HiringError} from '../../lib/hiring/errors';
import {validateAnswers} from '../../lib/hiring/validation';
import test from 'node:test';
import assert from 'node:assert/strict';
import {withRequiredApplicationFields,withRequiredLinkedIn,linkedInPath} from '../../lib/hiring/contact-fields';
import {websiteLinkError} from '../../lib/hiring/website-links';
import {customDatabase,openSyntheticRole} from '../custom-fixture';
test('LinkedIn normalization locks built-in and preserves legacy answer path and unrelated fields',()=>{
 const fields=[{path:'legacy_linkedin',title:'LinkedIn profile (optional)',type:'Url' as const,required:false},{path:'notes',title:'LinkedIn recruiting experience',type:'String' as const,required:false}];
 const result=withRequiredLinkedIn(fields);assert.equal(result.length,2);assert.equal(result[0].path,'legacy_linkedin');assert.equal(result[0].required,true);assert.equal(result[0].type,'SocialLink');assert.deepEqual(result[1],fields[1]);assert.deepEqual(withRequiredLinkedIn(result),result);assert.equal(fields[0].required,false);
 const canonical=withRequiredApplicationFields([]).find(v=>v.path===linkedInPath)!;assert.equal(canonical.required,true);
});
test('LinkedIn accepts personal profiles only, including country hosts and legacy pub',()=>{
 const field={path:linkedInPath,title:'LinkedIn profile'};
 for(const value of ['https://www.linkedin.com/in/person','https://uk.linkedin.com/in/person/','https://linkedin.com/pub/person/1/2'])assert.equal(websiteLinkError(value,field),null);
 for(const value of ['','https://linkedin.com','https://linkedin.com/company/test','https://linkedin.com/in/','https://linkedin.com.evil.test/in/person','javascript:alert(1)'])assert.ok(websiteLinkError(value,field));
});
test('existing job public definition immediately requires LinkedIn without rewriting stored configuration',async()=>{
 const f=customDatabase();try{const job=await openSyntheticRole(f.store);const before=await f.store.getJob(job.id);const definition=await f.store.jobDefinition(job.id);assert.equal(definition.fields.find(v=>v.path===linkedInPath)?.required,true);assert.deepEqual((await f.store.getJob(job.id)).fields,before.fields);}finally{f.database.close();}
});

 test('a stale form with no LinkedIn answer receives actionable refresh instructions without claiming saved answers',()=>{
  const fields=withRequiredLinkedIn([]);
  assert.throws(()=>validateAnswers({jobPostingId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fieldSubmissions:[]},fields),error=>{
   assert.ok(error instanceof HiringError);
   assert.equal(error.code,'invalid_application');assert.equal(error.status,422);
   assert.match(error.message,/copy your entered answers before refreshing/);
   assert.match(error.message,/reattach your résumé/);
   assert.equal(error.fieldErrors?.[linkedInPath],'LinkedIn profile is required.');return true;
  });
 });
