import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const adapter=new URL('../../scripts/hiring-mcp.mjs',import.meta.url).pathname;
async function run(messages,mode='normal',token='test-secret'){
 const dir=await mkdtemp(join(tmpdir(),'hiring-mcp-'));const mock=join(dir,'mock.mjs');
 await writeFile(mock,`globalThis.fetch=async (url,options)=>{const u=new URL(url);if(options.headers.Authorization!=='Bearer '+${JSON.stringify(token||'test-secret')})throw Error('secret '+${JSON.stringify(token||'test-secret')});if(${JSON.stringify(mode)}==='credential-key')return Response.json({error:{code:'rate_limited',message:'Read limit reached.',limit:{[${JSON.stringify(token)}]:1}}},{status:429});if(${JSON.stringify(mode)}==='allowed-error-secret')throw Error('The hiring API rejected '+${JSON.stringify(token)});if(${JSON.stringify(mode)}==='large')return new Response(new Uint8Array(3*1024*1024+1));if(${JSON.stringify(mode)}==='denied')return Response.json({error:{code:'agent_unauthorized',message:'Scope not granted'}},{status:403});if(${JSON.stringify(mode)}==='limited')return Response.json({error:{code:'agent_rate_limited',message:'Read limit reached; token test-secret must stay private.',limit:{requests:60,windowSeconds:60,token:'test-secret'}}},{status:429,headers:{'Retry-After':'7'}});if(${JSON.stringify(mode)}==='limited-boundary')return Response.json({error:{code:'rate_limited',message:'x'.repeat(1996)+'test-secret'}},{status:429});if(${JSON.stringify(mode)}==='limited-text')return new Response('Unavailable',{status:429,headers:{'Retry-After':'9'}});if(${JSON.stringify(mode)}==='api-timeout')return Response.json({error:{code:'read_timeout',message:'Read deadline exceeded.',limit:{timeoutMs:20000},retryAfterSeconds:5}},{status:504});if(${JSON.stringify(mode)}==='timeout')throw new DOMException('provider timeout test-secret','TimeoutError');if(['body-timeout','error-body-timeout'].includes(${JSON.stringify(mode)}))return new Response(new ReadableStream({start(controller){controller.error(new DOMException('body timeout test-secret','TimeoutError'))}}),{status:${JSON.stringify(mode)}==='error-body-timeout'?503:200});if(u.searchParams.get('action')==='file_content')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/pdf'}});return Response.json({data:{path:u.pathname,query:Object.fromEntries(u.searchParams),allJobIds:u.searchParams.getAll('jobIds'),method:options.method,body:options.body?JSON.parse(options.body):null}})};`);
 try{return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import',mock,adapter],{env:{...process.env,HIRING_ORIGIN:'https://careers.example.invalid',HIRING_API_TOKEN:token}});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>{assert.equal(code,0,stderr);assert.ok(!stdout.includes('test-secret'));if(token)assert.ok(!stdout.includes(token));resolve(stdout.trim().split('\n').map(JSON.parse))});child.stdin.end(messages.map(m=>JSON.stringify(m)).join('\n')+'\n');});}finally{await rm(dir,{recursive:true,force:true});}
}
const call=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
test('stdio initialization discovery and existing draft/publish tools remain compatible',async()=>{
 const results=await run([{id:1,method:'initialize'},{method:'notifications/initialized'},{id:2,method:'tools/list'},call('draft_jobs',{text:'Engineer',countries:['India']}),call('publish_jobs',{jobs:[],confirm:false})]);
 assert.equal(results.length,4);assert.equal(results[0].result.protocolVersion,'2024-11-05');assert.equal(results[1].result.tools.length,14);assert.ok(results[1].result.tools.some(t=>t.name==='get_resume_text'));
 const draft=JSON.parse(results[2].result.content[0].text);assert.equal(draft.data.path,'/api/agent-jobs');assert.equal(draft.data.body.action,'draft');assert.equal(results[3].error.message,'Publishing requires confirm=true after explicit user approval.');
});
test('bulk tools are read-only, bounded and route grouped pages without caller action overrides',async()=>{
 const [listed]=await run([{id:1,method:'tools/list'}]);
 const bulk=listed.result.tools.filter(tool=>['export_applicants','search_applicants'].includes(tool.name));assert.equal(bulk.length,2);
 for(const tool of bulk){assert.match(tool.description,/applicants:read only/);assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});assert.equal(tool.inputSchema.properties.pageSize.maximum,30);assert.equal(tool.inputSchema.properties.jobIds.maxItems,50);assert.equal(tool.inputSchema.properties.jobId.maxLength,128);assert.equal(tool.inputSchema.properties.jobIds.items.maxLength,128);assert.equal(tool.inputSchema.properties.cursor.maxLength,2048);assert.equal(tool.inputSchema.additionalProperties,false);for(const key of ['oneOf','anyOf','allOf','not'])assert.equal(tool.inputSchema[key],undefined);}
 assert.ok(!listed.result.tools.some(tool=>/shortlist|move_applicant|update_applicant|delete_applicant/.test(tool.name)));
 const [exported,searched]=await run([call('export_applicants',{jobIds:['job-a','job-b'],pageSize:30,cursor:'opaque-next',action:'publish'}),call('search_applicants',{query:'offline conversion',jobId:'job-a',pageSize:2,cursor:'search-next',action:'reject'})]);
 const first=JSON.parse(exported.result.content[0].text).data,second=JSON.parse(searched.result.content[0].text).data;
 assert.equal(first.path,'/api/agent-read');assert.equal(first.method,'GET');assert.equal(first.body,null);assert.equal(first.query.action,'export_applicants');assert.deepEqual(first.allJobIds,['job-a','job-b']);assert.equal(first.query.pageSize,'30');assert.equal(first.query.cursor,'opaque-next');
 assert.deepEqual(second.query,{action:'search_applicants',q:'offline conversion',jobId:'job-a',pageSize:'2',cursor:'search-next'});assert.equal(second.method,'GET');
});
test('rate limits and scope failures retain typed execution errors with retry metadata and no secrets',async()=>{
 const [limited]=await run([call('export_applicants',{jobId:'job-a'})],'limited');
 assert.equal(limited.result.isError,true);assert.equal(limited.error,undefined);
 const error=limited.result.structuredContent.error;assert.equal(error.code,'agent_rate_limited');assert.equal(error.httpStatus,429);assert.equal(error.retryAfterSeconds,7);assert.deepEqual(error.limit,{requests:60,windowSeconds:60});assert.match(error.message,/Read limit reached/);assert.ok(error.message.includes('[redacted-token]'));assert.deepEqual(JSON.parse(limited.result.content[0].text),limited.result.structuredContent);
 const [boundary]=await run([call('export_applicants',{jobId:'job-a'})],'limited-boundary');assert.equal(boundary.result.isError,true);assert.ok(!boundary.result.structuredContent.error.message.includes('test'));assert.equal(boundary.result.structuredContent.error.message.length,2000);
 const [plain]=await run([call('export_applicants',{jobId:'job-a'})],'limited-text');assert.equal(plain.result.isError,true);assert.deepEqual(plain.result.structuredContent.error.limit,{type:'upstream',value:'not_provided'});assert.equal(plain.result.structuredContent.error.retryAfterSeconds,9);assert.equal(plain.result.structuredContent.error.httpStatus,429);
 const [denied]=await run([call('search_applicants',{query:'personal injury'})],'denied');assert.equal(denied.result.isError,true);assert.equal(denied.result.structuredContent.error.code,'agent_unauthorized');assert.equal(denied.result.structuredContent.error.httpStatus,403);
});
test('API and local timeouts expose their deadlines and retry-after instead of generic protocol failures',async()=>{
 const [api]=await run([call('search_applicants',{query:'personal injury'})],'api-timeout');assert.equal(api.result.isError,true);assert.deepEqual(api.result.structuredContent.error,{code:'read_timeout',message:'Read deadline exceeded.',httpStatus:504,limit:{timeoutMs:20000},retryAfterSeconds:5});
 for(const mode of ['timeout','body-timeout','error-body-timeout']){const [result]=await run([call('export_applicants',{jobId:'job-a'})],mode);assert.equal(result.error,undefined);assert.equal(result.result.isError,true);const error=result.result.structuredContent.error;assert.equal(error.code,'request_timeout');assert.equal(error.httpStatus,null);assert.deepEqual(error.limit,{timeoutMs:100000});assert.equal(error.retryAfterSeconds,5);assert.match(error.message,/100-second/);}
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

test('credentials in operational metadata keys and allowlisted exception messages are redacted',async()=>{
 const credential='live-credential-material';
 const [limited]=await run([call('export_applicants',{jobId:'job-a'})],'credential-key',credential);
 assert.equal(limited.result.isError,true);assert.deepEqual(limited.result.structuredContent.error.limit,{'[redacted-token]':1});
 const [exception]=await run([call('export_applicants',{jobId:'job-a'})],'allowed-error-secret',credential);
 assert.equal(exception.error.message,'The hiring API rejected [redacted-token]');
});

test('single multi-country mode is forwarded by draft and validate, and full jobInput is published unchanged',async()=>{
 const draft={title:'Media Buyer',description:'Manage campaigns',questions:[{title:'Experience?',type:'ValueSelect',options:[{value:'none',label:'None'}],rules:[{operator:'not_equals',value:'none'}]}]};
 const jobs=[{title:'Written title',status:'open',fields:[{path:'country_of_residence',type:'ValueSelect'}],rules:[{operator:'in',value:['US','IN']}]}];
 const [d,v,p]=await run([call('draft_jobs',{text:'Supplied complete job description.',countries:['US','IN'],countryMode:'single'}),call('validate_jobs',{draft,countries:['US','IN'],countryMode:'single'}),call('publish_jobs',{jobs,confirm:true,replaceExisting:true})]);
 assert.equal(JSON.parse(d.result.content[0].text).data.body.input.countryMode,'single');assert.equal(JSON.parse(v.result.content[0].text).data.body.countryMode,'single');assert.deepEqual(JSON.parse(v.result.content[0].text).data.body.draft,draft);assert.deepEqual(JSON.parse(p.result.content[0].text).data.body.jobs,jobs);assert.equal(JSON.parse(p.result.content[0].text).data.body.replaceExisting,true);
});

test('reject tool uses a distinct write endpoint and requires confirmation',async()=>{
 const args={applicationId:'app_'+ 'a'.repeat(64),expectedRevision:2,reason:'private',confirm:true};
 const [accepted,unconfirmed]=await run([call('reject_applicant',args),call('reject_applicant',{...args,confirm:false})]);
 const data=JSON.parse(accepted.result.content[0].text).data;assert.equal(data.path,'/api/agent-applicants');assert.equal(data.method,'POST');assert.deepEqual(data.body,args);assert.match(unconfirmed.error.message,/require[s]* confirm=true/);
});

test('interview request is scoped write endpoint requiring confirmation',async()=>{
 const args={applicationId:'app_'+ 'a'.repeat(64),expectedRevision:2,interviewerEmail:'owner@example.com',confirm:true};
 const [accepted,unconfirmed]=await run([call('request_interview',args),call('request_interview',{...args,confirm:false})]);
 const data=JSON.parse(accepted.result.content[0].text).data;assert.equal(data.path,'/api/agent-interviews');assert.equal(data.method,'POST');assert.deepEqual(data.body,args);assert.match(unconfirmed.error.message,/require[s]* confirm=true/);
});
