// Actual custom hiring HTTP handler + HubStore + D1 SQL. Google effects remain queued.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import {customDatabase,openSyntheticRole,uploadSyntheticResume} from './custom-fixture.ts';
import {LocalHiringProvider,LocalHiringStore,acceptLocalApplication} from '../lib/hiring/local.ts';
import {postApplication,getReceipt} from '../lib/hiring/http.ts';
const {database,db,store}=customDatabase();
const engineer=await openSyntheticRole(store);
const creative=await store.saveJob({...engineer,title:'Synthetic Creative Strategist',slug:'synthetic-creative-strategist'});
const deps={provider:new LocalHiringProvider(db),store:new LocalHiringStore(db),applicationsEnabled:true,customSubmit:(input,session)=>acceptLocalApplication(db,input,session,true,true)};
let origin;
const server=createServer(async(request,response)=>{
 try{
  const chunks=[];for await(const chunk of request)chunks.push(chunk);
  const headers=new Headers();for(const [key,value] of Object.entries(request.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
  const web=new Request(new URL(request.url,origin),{method:request.method,headers,...(request.method==='GET'?{}:{body:Buffer.concat(chunks)})});
  const result=new URL(web.url).pathname==='/api/applications'?await postApplication(web,deps):await getReceipt(new URL(web.url).pathname.split('/').at(-1),deps);
  response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
 }catch{response.writeHead(500);response.end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
const started=performance.now(),latencies=[],receipts=[];
const submit=async(input,session)=>{
 const before=performance.now();const response=await fetch(`${origin}/api/applications`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:`hiring_session=${session}`},body:JSON.stringify(input)});
 const body=await response.json();latencies.push(performance.now()-before);assert.equal(response.status,201,JSON.stringify(body));assert.equal(body.status,'accepted');assert.match(body.receipt,/^[a-f0-9]{64}$/);return body;
};
const payload=(jobId,seq)=>({jobPostingId:jobId,formVersion:jobId===engineer.id?engineer.formVersion:creative.formVersion,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_phone",value:"+1 305 555 0123"},{path:'_systemfield_name',value:`Synthetic Applicant ${seq}`},{path:'_systemfield_email',value:`synthetic-${seq}@example.invalid`}],utmData:{utm_source:seq%2?'synthetic-careers':'synthetic-referral'}});
try{
 for(let batch=0;batch<30;batch++){
  const results=await Promise.all(Array.from({length:100},async(_,index)=>{const seq=batch*100+index,session=randomBytes(32).toString('hex'),input=payload(seq%2?creative.id:engineer.id,seq);input.fieldSubmissions.push(await uploadSyntheticResume(db,input.jobPostingId,session));return submit(input,session);}));receipts.push(...results.map(r=>r.receipt));
 }
 const count=table=>Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
 assert.equal(count('hub_applications'),3000);assert.equal(count('hiring_submissions'),3000);assert.equal(count('hub_tasks'),6000);assert.equal(count('hub_communications'),3000);assert.equal(new Set(receipts).size,3000);
 for(const receipt of [receipts[0],receipts[1499],receipts[2999]]){const response=await fetch(`${origin}/api/applications/${receipt}`);assert.equal(response.status,200);assert.equal((await response.json()).status,'accepted');}
 assert.equal((await fetch(`${origin}/api/applications/${'f'.repeat(64)}`)).status,404);
 const repeated=payload(engineer.id,'repeated'),session=randomBytes(32).toString('hex');
 repeated.fieldSubmissions.push(await uploadSyntheticResume(db,engineer.id,session));
 await Promise.all(Array.from({length:100},()=>acceptLocalApplication(db,repeated,session,true,true)));
 assert.equal(count('hub_applications'),3001);assert.equal(count('hiring_submissions'),3001);assert.equal(count('hub_tasks'),6002);
 assert.equal(count('hub_files'),3001);assert.equal(Number(database.prepare('SELECT COUNT(*) AS n FROM hub_files WHERE application_id IS NOT NULL').get().n),3001);
 const reports=await store.reports();assert.equal(reports.applications,3001);assert.equal(reports.sources.reduce((sum,s)=>sum+s.count,0),3001);
 latencies.sort((a,b)=>a-b);
 console.log(JSON.stringify({status:'passed',syntheticApplications:3000,roles:2,concurrentHttpRequestsPerBatch:100,duplicateConcurrentCalls:100,duplicateApplicationsCreated:1,queuedTasks:count('hub_tasks'),elapsedMs:Math.round(performance.now()-started),requestMedianMs:Math.round(latencies[Math.floor(latencies.length*.5)]),requestP95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),limitations:'Local Node HTTP and production custom hiring/D1 SQL against SQLite. Real synthetic PDF upload validation uses an isolated object sink. Gmail, Calendar and Drive effects are queued and isolated. This does not measure hosted quotas or live Google capacity.'},null,2));
}finally{await new Promise(resolve=>server.close(resolve));database.close();}
