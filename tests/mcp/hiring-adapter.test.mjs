import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const adapter=new URL('../../scripts/hiring-mcp.mjs',import.meta.url).pathname;
async function run(messages,mode='normal',token='test-secret'){
 const dir=await mkdtemp(join(tmpdir(),'hiring-mcp-'));const mock=join(dir,'mock.mjs');
 await writeFile(mock,`globalThis.fetch=async (url,options)=>{const u=new URL(url);if(options.headers.Authorization!=='Bearer test-secret')throw Error('secret test-secret');if(${JSON.stringify(mode)}==='large')return new Response(new Uint8Array(3*1024*1024+1));if(${JSON.stringify(mode)}==='denied')return Response.json({error:{message:'Scope not granted'}},{status:403});if(u.searchParams.get('action')==='file_content')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/pdf'}});return Response.json({data:{path:u.pathname,query:Object.fromEntries(u.searchParams),method:options.method,body:options.body?JSON.parse(options.body):null}})};`);
 try{return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import',mock,adapter],{env:{...process.env,HIRING_ORIGIN:'https://careers.example.invalid',HIRING_API_TOKEN:token}});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>{assert.equal(code,0,stderr);assert.ok(!stdout.includes('test-secret'));resolve(stdout.trim().split('\n').map(JSON.parse))});child.stdin.end(messages.map(m=>JSON.stringify(m)).join('\n')+'\n');});}finally{await rm(dir,{recursive:true,force:true});}
}
const call=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
test('stdio initialization discovery and existing draft/publish tools remain compatible',async()=>{
 const results=await run([{id:1,method:'initialize'},{method:'notifications/initialized'},{id:2,method:'tools/list'},call('draft_jobs',{text:'Engineer',countries:['India']}),call('publish_jobs',{jobs:[],confirm:false})]);
 assert.equal(results.length,4);assert.equal(results[0].result.protocolVersion,'2024-11-05');assert.equal(results[1].result.tools.length,10);assert.ok(results[1].result.tools.some(t=>t.name==='get_resume_text'));
 const draft=JSON.parse(results[2].result.content[0].text);assert.equal(draft.data.path,'/api/agent-jobs');assert.equal(draft.data.body.action,'draft');assert.equal(results[3].error.message,'Publishing requires confirm=true after explicit user approval.');
});
test('read tools map to bearer read endpoint with bounded pagination and no caller action override',async()=>{
 const [r]=await run([call('list_applicants',{page:2,pageSize:30,jobId:'job',stage:'Interview',search:'Ada',active:false,excludeStage:'Rejected',qualification:'qualified',assignee:'me@example.test',appliedFrom:'2026-01-01',appliedTo:'2026-02-01',timeZone:'America/Bogota',sort:'newest',action:'publish'})]);const data=JSON.parse(r.result.content[0].text).data;
 assert.equal(data.method,'GET');assert.equal(data.path,'/api/agent-read');assert.deepEqual(data.query,{action:'list_applicants',page:'2',pageSize:'30',jobId:'job',stage:'Interview',excludeStage:'Rejected',q:'Ada',active:'false',qualification:'qualified',assignee:'me@example.test',appliedFrom:'2026-01-01',appliedTo:'2026-02-01',timeZone:'America/Bogota',sort:'newest'});
 const [detail,evidence]=await run([call('get_applicant',{applicationId:'a',sectionPageSize:5,communicationsPage:2,notesPage:3}),call('get_interview_evidence',{applicationId:'a',meetingId:'m',textPage:2})]);
 assert.deepEqual(JSON.parse(detail.result.content[0].text).data.query,{action:'get_applicant',applicationId:'a',sectionPageSize:'5',communicationsPage:'2',notesPage:'3'});
 assert.deepEqual(JSON.parse(evidence.result.content[0].text).data.query,{action:'get_interview_evidence',applicationId:'a',meetingId:'m',textPage:'2'});
 const [file]=await run([call('get_applicant_file',{applicationId:'a',fileId:'f'})]);assert.equal(JSON.parse(file.result.content[0].text).data.content,'AQID');
});
test('missing token scopes unknown tools and oversized responses fail without credential output',async()=>{
 assert.match((await run([call('list_jobs')],'normal',''))[0].error.message,/Set HIRING_API_TOKEN/);
 assert.equal((await run([call('list_jobs')],'denied'))[0].result.isError,true);
 assert.match((await run([call('list_jobs')],'large'))[0].error.message,/Response exceeds/);
 assert.equal((await run([call('anything')]))[0].error.message,'Unknown tool');
 assert.match((await run([call('get_applicant_file',{applicationId:'a',fileId:'f'})],'large'))[0].error.message,/2 MB/);
});
