import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withRequiredContacts, contactPaths, internationalPhoneError, applicantDisplayName} from '../../lib/hiring/contact-fields';
import {validateAnswers} from '../../lib/hiring/validation';
test('required contacts stay first while custom question order is preserved',()=>{
 const fields=withRequiredContacts([{path:'work',title:'Work',type:'Url',required:false},{path:'experience',title:'Experience',type:'Number',required:true}]);
 assert.deepEqual(fields.slice(0,4).map(f=>f.path),contactPaths);
 assert.ok(fields.slice(0,4).every(f=>f.required));
 assert.deepEqual(fields.slice(4).map(f=>f.path),['work','experience']);
 assert.deepEqual(withRequiredContacts(fields),fields);
 assert.equal(applicantDisplayName([{path:'_systemfield_name',value:'Maria'},{path:'_systemfield_last_name',value:'Garcia'}]),'Maria Garcia');
 assert.equal(applicantDisplayName([{path:'_systemfield_name',value:'Legacy Full Name'}]),'Legacy Full Name');
});
test('phone requires international prefix and bounded digits, both client helper and server',()=>{
 for(const phone of ['+1 305 555 0123','+57 301 234 5678','+44 20 7946 0958']) assert.equal(internationalPhoneError(phone),null);
 for(const phone of ['3055550123','KKK','+123','+01234567890','+1234567890123456']) {
  assert.ok(internationalPhoneError(phone));
  assert.throws(()=>validateAnswers({jobPostingId:'test',submissionKey:'test',fieldSubmissions:[{path:'phone',value:phone}]},[{path:'phone',title:'Phone',type:'Phone',required:true}]),{code:'invalid_application'});
 }
});

test('public legacy job requires canonical international phone and saves its field with the application',async()=>{
 const {customDatabase,openSyntheticRole,uploadSyntheticResume}=await import('../custom-fixture');
 const {LocalHiringProvider,acceptLocalApplication}=await import('../../lib/hiring/local');
 const f=customDatabase();try{
  const job=await openSyntheticRole(f.store);
  const definition=await new LocalHiringProvider(f.db).jobInfo(job.id);
  assert.deepEqual(definition.fields.find(field=>field.path==='_systemfield_phone')?.type,'Phone');
  assert.equal(definition.fields.find(field=>field.path==='_systemfield_phone')?.required,true);
  const base={jobPostingId:job.id,submissionKey:crypto.randomUUID(),formVersion:job.formVersion,fieldSubmissions:[{path:'linkedin_profile',value:'https://www.linkedin.com/in/synthetic-applicant'},{path:'_systemfield_name',value:'Legacy Applicant'},{path:'_systemfield_email',value:'applicant@example.invalid'}]};
  await assert.rejects(()=>acceptLocalApplication(f.db,base,'a'.repeat(64),true,true),{code:'invalid_application'});
  for(const value of ['', '3055550123', '+123', '+01234567890'])await assert.rejects(()=>acceptLocalApplication(f.db,{...base,fieldSubmissions:[...base.fieldSubmissions,{path:'_systemfield_phone',value}]},'a'.repeat(64),true,true),{code:'invalid_application'});
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM hub_applications').get()!.n,0);
  const handle=await uploadSyntheticResume(f.db,job.id,'a'.repeat(64));
  const input={...base,fieldSubmissions:[...base.fieldSubmissions,{path:'_systemfield_phone',value:'+57 301 234 5678'},handle]};
  assert.equal((await acceptLocalApplication(f.db,input,'a'.repeat(64),true,true)).status,'accepted');
  assert.equal((await acceptLocalApplication(f.db,input,'a'.repeat(64),true,true)).status,'accepted');
  const row=f.database.prepare('SELECT fields_json,answers_json FROM hub_applications').get()!;
  assert.equal(JSON.parse(String(row.fields_json)).find((field:{path:string})=>field.path==='_systemfield_phone').required,true);
  assert.equal(JSON.parse(String(row.answers_json)).find((field:{path:string})=>field.path==='_systemfield_phone').value,'+57 301 234 5678');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM hub_applications').get()!.n,1);
 }finally{f.database.close();}
});

test('legacy optional or wrongly typed canonical phone cannot bypass public enforcement',async()=>{
 const {withRequiredPhone}=await import('../../lib/hiring/contact-fields');
 const fields=withRequiredPhone([{path:'_systemfield_phone',title:'Optional phone',type:'String',required:false}]);
 assert.equal(fields.length,1);assert.equal(fields[0].required,true);assert.equal(fields[0].type,'Phone');
 assert.deepEqual(withRequiredPhone(fields),fields);
 assert.throws(()=>validateAnswers({jobPostingId:'test',submissionKey:'test',fieldSubmissions:[]},fields),{code:'invalid_application'});
});
