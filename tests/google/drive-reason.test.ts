import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveArchive} from '../../lib/archive/drive';
import {ProviderError} from '../../lib/archive/http';
import type {ItemState} from '../../lib/archive/contracts';
function archive(body:()=>Response){return new GoogleDriveArchive({clientId:'test',clientSecret:'test',refreshToken:'test'},{} as ItemState,async url=>String(url).includes('oauth2')?new Response(JSON.stringify({access_token:'test'})):body());}
test('Drive 403 preserves only allowlisted machine reasons, never provider message or applicant data',async()=>{
 for(const [reason,expected] of [['insufficientFilePermissions','drive_insufficient_file_permissions'],['storageQuotaExceeded','drive_storage_quota_exceeded'],['appNotAuthorizedToFile','drive_app_not_authorized_to_file'],['private@example.invalid',undefined],['__proto__',undefined]] as const){
 const client=archive(()=>new Response(JSON.stringify({error:{message:'private@example.invalid resume.pdf secret-token',errors:[{reason}]}}),{status:403}));
 await assert.rejects(client.assertPrivateRoot('root'),(error:unknown)=>{assert.ok(error instanceof ProviderError);assert.equal(error.status,403);assert.equal(error.code,expected);assert.ok(!JSON.stringify(error).includes('private@'));return true;});
 }
});
test('Drive diagnostics are byte and time bounded and do not alter resumable or not-found handling',async()=>{
 for(const body of ['not json',JSON.stringify({error:{message:'x'.repeat(20000),errors:[{reason:'storageQuotaExceeded'}]}})])await assert.rejects(archive(()=>new Response(body,{status:403})).assertPrivateRoot('root'),(e:unknown)=>e instanceof ProviderError&&e.status===403&&!e.code);
 let cancelled=false;const client=archive(()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:403}));client.deadline=Date.now()+40;const start=Date.now();await assert.rejects(client.assertPrivateRoot('root'),ProviderError);assert.ok(Date.now()-start<500);assert.equal(cancelled,true);
 await assert.rejects(archive(()=>new Response(null,{status:404})).assertPrivateRoot('root'),/drive_root_unavailable/);
});
