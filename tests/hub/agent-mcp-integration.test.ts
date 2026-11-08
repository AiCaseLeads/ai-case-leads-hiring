import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,jobInput,applicationInput} from './fixtures';
import {makePdf} from '../pdf/fixtures';
import {issueAccess} from '../../lib/agent-api/access';
import {handleAgentRead} from '../../lib/agent-api/read';
import {processResumeTextBatch} from '../../lib/resume-text/worker';

type CandidatePage={items:{email:string;applications:{resumeText:string;applicationId:string}[]}[];nextCursor:string|null;hasMore:boolean};
type RpcReply={result:{isError?:boolean;content:{text:string}[];structuredContent?:{error:{code:string;httpStatus:number}}}};
test('real stdio MCP reaches authenticated API and stored PDF text with grouped cursor pages', {timeout:15000},async()=>{
 const {store,database}=createStore(),dir=await mkdtemp(join(tmpdir(),'hiring-mcp-wire-'));
 const server=createServer(async(incoming,outgoing)=>{
  try{
   const response=await handleAgentRead(new Request('https://careers.example.invalid'+incoming.url,{method:incoming.method,headers:{authorization:incoming.headers.authorization||''}}),store);
   outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{outgoing.writeHead(500);outgoing.end();}
 });
 let child:ReturnType<typeof spawn>|undefined;
 try{
  const first=await store.saveJob(jobInput()),second=await store.saveJob(jobInput());
  const makeApp=async(jobId:string,email:string)=>{const input=applicationInput(jobId);input.fieldSubmissions.find(field=>field.path==='_systemfield_email')!.value=email;return store.acceptApplication(input);};
  const alpha=await makeApp(first.id,'alpha@example.invalid');await makeApp(second.id,'alpha@example.invalid');await makeApp(first.id,'zebra@example.invalid');
  const fileId='8'.repeat(64),bytes=makePdf('Built offline conversion tools for personal injury teams.');
  database.prepare('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(fileId,first.id,'_systemfield_resume','resume.pdf','application/pdf',bytes.length,'private/wire',1,alpha.id,Date.now()+100000,'a'.repeat(64));
  let originalReads=0;
  const bucket={get:async()=>{originalReads++;return {size:bytes.length,customMetadata:{fileId},body:new Response(bytes as BodyInit).body!};}} as unknown as R2Bucket;
  await processResumeTextBatch({store,bucket});assert.equal(originalReads,1);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  // Test-only loopback transport. The actual adapter URL validation, headers,
  // serialization and API authorization remain active; no external service runs.
  const shim=join(dir,'loopback.mjs');await writeFile(shim,`const realFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{const source=new URL(url);if(source.origin!=='https://careers.example.invalid')throw Error('Unexpected test origin');return realFetch('http://127.0.0.1:${address.port}'+source.pathname+source.search,options);};`,{mode:0o600});
  const access=await issueAccess(store,'wire',['applicants:read'],'owner');
  child=spawn(process.execPath,['--import',shim,new URL('../../scripts/hiring-mcp.mjs',import.meta.url).pathname],{env:{...process.env,HIRING_ORIGIN:'https://careers.example.invalid',HIRING_API_TOKEN:access.token},stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout!}),pending=new Map<number,{resolve:(value:RpcReply)=>void;reject:(error:Error)=>void}>();let sequence=0;
  lines.on('line',line=>{const value=JSON.parse(line);const waiting=pending.get(value.id);if(waiting){pending.delete(value.id);waiting.resolve(value);}});
  child.on('close',()=>{for(const waiting of pending.values())waiting.reject(new Error('Adapter exited before replying'));});
  const call=(name:string,args:unknown)=>new Promise<RpcReply>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');});
  const args={jobIds:[first.id,second.id],pageSize:1};
  const firstReply=await call('export_applicants',args);assert.equal(firstReply.result.isError,false);
  const page=(JSON.parse(firstReply.result.content[0].text) as {data:CandidatePage}).data;
  assert.equal(page.items.length,1);assert.equal(page.items[0].email,'alpha@example.invalid');assert.equal(page.items[0].applications.length,2);assert.match(page.items[0].applications.find(app=>app.applicationId===alpha.id)!.resumeText,/offline conversion/);assert.equal(page.hasMore,true);
  const next=JSON.parse((await call('export_applicants',{...args,cursor:page.nextCursor})).result.content[0].text).data as CandidatePage;
  assert.deepEqual(next.items.map(item=>item.email),['zebra@example.invalid']);assert.equal(next.hasMore,false);
  const search=JSON.parse((await call('search_applicants',{query:'personal injury'})).result.content[0].text).data as CandidatePage;
  assert.equal(search.items[0].applications.length,2);assert.equal(originalReads,1,'all MCP reads use cached text without fetching originals');
  const record=await store.setting<Record<string,unknown>>('agent_access_'+access.id,{});await store.setSetting('agent_access_'+access.id,{...record,scopes:['jobs:read']});
  const denied=await call('export_applicants',args);assert.equal(denied.result.isError,true);assert.equal(denied.result.structuredContent!.error.code,'agent_unauthorized');assert.equal(denied.result.structuredContent!.error.httpStatus,403);
 }finally{
  if(child&&!child.killed)child.kill();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));database.close();await rm(dir,{recursive:true,force:true});
 }
});
