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
