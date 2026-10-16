import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const job={id:'job-test',title:'Test engineer',slug:'engineer',status:'open',location:'Remote',fields:[],rules:[]};
const applicant={id:'app-test',name:'Synthetic Applicant',email:'applicant@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',createdAt:1,revision:1};
async function setup(t,{mode='candidate',data={status:'ready',score:80,criteria:[]},failWrite=false,width=390,clock=false}={}){
 const view=mode==='config'?'<AiReviewSettings/>':mode==='candidate'?'<CandidateMatch applicationId="app-test"/>':mode==='setup'?'<JobMatchSetup jobId="job-test" changed={()=>{}}/>':`<Candidates jobs={${JSON.stringify([job])}} refresh={0} changed={()=>{}} reviewerEmail="reviewer@example.invalid" initialJobId="job-test"/>`;
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AiReviewSettings}from'./components/hub/ai-review';import{CandidateMatch,JobMatchSetup}from'./components/hub/ai-match';import{Candidates}from'./components/hub/candidates';createRoot(document.getElementById('root')).render(${view});`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 // Keep application CSS, excluding build-only Tailwind directives.
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main class="hub-main"><div id="root"></div></main><script src="/bundle.js"></script>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(5000);
 let current=structuredClone(data);const writes=[],queries=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/ai/match*',route=>{
  const request=route.request();if(request.method()!=='GET'){
   const input=request.postDataJSON();writes.push({method:request.method(),...input});
   if(failWrite)return route.fulfill({status:503,json:{error:{message:'Provider unavailable. Please try again.'}}});
   if(request.method()==='PATCH')current={...current,enabled:input.enabled,status:input.enabled?'pending':'disabled'};
  }
  return route.fulfill({json:{data:current}});
 });
 await page.route('**/api/ai/config',async route=>{if(route.request().method()!=='GET'){const input=route.request().postDataJSON();writes.push({method:route.request().method(),...input});current={...current,...input};}return route.fulfill({json:{data:current}});});
 await page.route('**/api/hub/applications*',route=>{queries.push(new URL(route.request().url()).searchParams);return route.fulfill({json:{data:{items:[{...applicant,aiMatch:{status:'ready',score:80}},{...applicant,id:'app-pending',name:'Pending applicant',aiMatch:{status:'pending',score:null}}],total:2,page:1,pageSize:50}}});});
 if(clock)await page.clock.install();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 if(mode==='setup')await page.locator('summary').filter({hasText:'AI settings for this job'}).click();
 return {page,writes,queries,errors};
}

test('completed AI match shows job evidence, citations and uncertainty without replacing reviewer decisions',async t=>{
 const {page,errors}=await setup(t,{data:{status:'ready',score:83.6,model:'openai/test',sourceWarnings:['Portfolio file was not readable.'],criteria:[{criterion:'React experience',status:'evidence_found',explanation:'Resume describes React delivery.',citations:[{source:'resume:cv.pdf',quote:'Built React interfaces for 3 years.'}]},{criterion:'Team leadership',status:'needs_verification',explanation:'Clarify team size in interview.',citations:[]}]}});
 await page.getByText('84 / 100',{exact:true}).waitFor();await page.locator('.hub-match-source-evidence > summary').click();await page.locator('.hub-match-source-warnings > summary').click();assert.equal(await page.getByText('Built React interfaces for 3 years.',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText('Source: resume:cv.pdf',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText(/Needs clarification — Clarify team size/).isVisible(),true);
 assert.equal(await page.getByText('Portfolio file was not readable.',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText(/Missing evidence is not proof of missing ability/).isVisible(),true);
 assert.deepEqual(errors,[]);
});

test('pending, stale, failed and unreadable reviews never display misleading numeric scores',async t=>{
 for(const [status,label] of [['pending','Waiting for AI review'],['stale','Job changed · review needed'],['failed','AI review needs attention'],['needs_review','Needs manual review']]){
  const {page}=await setup(t,{data:{status,score:99,updatedAt:1,criteria:[],...(status==='failed'?{error:'Source extraction failed'}:{})}});
  await page.getByText(label,{exact:true}).waitFor();await page.locator('.hub-match-review-details > summary').click();await page.getByText(/^Updated /).waitFor();assert.equal(await page.getByText('99 / 100',{exact:true}).count(),0);
  if(status==='failed'){assert.match(await page.getByRole('alert').textContent(),/administrator should inspect server logs/);assert.equal(await page.getByText('Source extraction failed',{exact:true}).count(),0);}
 }
});

test('enabling one job is explicit and retrying existing applicants is a separate request',async t=>{
 const {page,writes}=await setup(t,{mode:'setup',data:{jobId:job.id,version:1,enabled:false,status:'disabled',criteria:['React experience']}});
 const toggle=page.getByRole('checkbox',{name:'Automatically review applicants for this job'});await toggle.waitFor();assert.equal(await toggle.isChecked(),false);assert.equal(writes.length,0);
 assert.equal(await page.getByText(/Enabling this reviews existing and new applicants, sending relevant résumé text and answers to OpenRouter/).isVisible(),true);
 await toggle.click();await page.getByRole('status').filter({hasText:'AI matching enabled'}).waitFor();assert.deepEqual(writes,[{method:'PATCH',jobId:job.id,enabled:true,expectedVersion:1,consent:true}]);
 await page.getByRole('button',{name:'Review existing applicants',exact:true}).click();await page.getByRole('status').filter({hasText:'Applications queued'}).waitFor();assert.deepEqual(writes[1],{method:'POST',jobId:job.id});
 await page.getByText('Requirements used for every applicant',{exact:true}).click();assert.equal(await page.getByText('React experience',{exact:true}).isVisible(),true);
 await toggle.click();await page.getByRole('status').filter({hasText:'Automatic AI matching is off'}).waitFor();assert.equal(writes[2].enabled,false);
});

test('failed enable stays off and explains the error instead of claiming success',async t=>{
 const {page,writes}=await setup(t,{mode:'setup',data:{jobId:job.id,version:1,enabled:false,status:'disabled',criteria:[]},failWrite:true});
 const toggle=page.getByRole('checkbox',{name:'Automatically review applicants for this job'});await toggle.click();await page.getByRole('alert').filter({hasText:'Provider unavailable'}).waitFor();assert.equal(await toggle.isChecked(),false);assert.equal(writes.length,1);assert.equal(await page.getByRole('button',{name:'Review existing applicants'}).count(),0);
});

test('AI sorting stays within its posting when filters are cleared',async t=>{
 const {page,queries}=await setup(t,{mode:'list',data:{jobId:job.id,version:1,enabled:false,status:'disabled',criteria:[]}});
 const order=page.getByLabel('Order',{exact:true});await order.waitFor();await order.selectOption('ai_match_desc');
 await Promise.all([page.waitForResponse(r=>r.url().includes('sort=ai_match_desc')),page.getByRole('button',{name:'Apply filters',exact:true}).click()]);
 assert.equal(queries.at(-1).get('jobId'),job.id);assert.equal(queries.at(-1).get('sort'),'ai_match_desc');
 await page.getByText('80 / 100',{exact:true}).waitFor();
 await Promise.all([page.waitForResponse(r=>r.url().includes('/api/hub/applications?')&&!r.url().includes('sort=')),page.getByRole('button',{name:'Clear filters',exact:true}).click()]);assert.equal(queries.at(-1).has('sort'),false);assert.equal(queries.at(-1).get('jobId'),job.id);
});

test('mobile AI evidence and consent remain within the viewport',async t=>{
 for(const mode of ['candidate','setup']){
  const {page}=await setup(t,{mode,data:{jobId:job.id,version:1,enabled:true,status:'ready',score:75,criteria:mode==='setup'?['Clear job requirement']:[{criterion:'Relevant experience',status:'evidence_found',explanation:'Application includes relevant work.',citations:[{source:'resume',quote:'Delivered customer projects.'}]}]}});
  if(mode==='setup')await page.getByRole('checkbox',{name:'Automatically review applicants for this job'}).waitFor();else await page.getByRole('heading',{name:'AI job match',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 }
});

 test('pending AI results refresh automatically and the list has an explicit refresh control',async t=>{
  const {page,queries}=await setup(t,{mode:'list',clock:true});
  await page.getByText('Waiting for AI review',{exact:true}).waitFor();
  const before=queries.length;
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/hub/applications?')),page.clock.fastForward(15001)]);
  assert.ok(queries.length>before);
  await page.getByRole('button',{name:'Refresh applications',exact:true}).waitFor();
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/hub/applications?')),page.getByRole('button',{name:'Refresh applications',exact:true}).click()]);
  assert.ok(queries.length>before+1);
 });

test('AI diagnostics explain waiting and capacity without starting paid review',async t=>{
 const {page,writes}=await setup(t,{mode:'setup',data:{enabled:true,jobId:'job-test',version:1,available:true,criteria:[],status:'pending',diagnostics:{counts:{pending:62,running:0,complete:0,failed:0,needsReview:0,notQueued:0,total:62},criteria:{status:'failed',attempts:1,error:'ai_provider_unavailable'},errors:[{code:'ai_invalid_response',count:1}],budget:{limit:100,used:100,remaining:0,resetsAt:1800000000000},worker:{enabled:true,encryptionKeyConfigured:true},reasons:['hourly_budget_exhausted']}}});
 await page.getByRole('heading',{name:'AI review progress'}).waitFor();await page.getByText(/62 waiting/).waitFor();await page.getByText(/Check the API key, credit balance and model access/).waitFor();await page.getByText(/AI response contained invalid or unsupported evidence/).waitFor();await page.getByText(/Hourly AI capacity is exhausted/).waitFor();assert.equal(writes.length,0);await page.getByRole('button',{name:'Refresh AI settings',exact:true}).click();assert.equal(writes.length,0);
});

test('candidate AI validation errors explain the evidence problem without a numeric score',async t=>{
 for (const [error,copy] of Object.entries({ai_response_truncated:'output limit',ai_response_refused:'declined to complete',ai_response_incomplete:'incomplete review',ai_response_json_invalid:'could not be read',ai_request_timeout:'timed out',ai_response_schema_invalid:'required review format',ai_response_criteria_mismatch:'this job’s requirements',ai_response_citation_policy:'evidence citation requirements',ai_response_quote_unverified:'submitted source text'})) {
  const {page}=await setup(t,{data:{status:'failed',score:null,error}});await page.getByRole('alert').filter({hasText:copy}).waitFor();assert.equal(await page.getByText('80 / 100',{exact:true}).count(),0);
 }
});


test('candidate distinguishes running, retry pause, capacity pause and queue ahead without misleading scores',async t=>{
 for(const [state,copy] of [['running','Attempt 1 of 5 is in progress'],['retry_scheduled','scheduled after'],['capacity_paused','hourly processing limit'],['queued','6 eligible reviews ahead'],['provider_paused','provider has paused']]){
  const {page,writes,errors}=await setup(t,{data:{status:state==='running'?'running':state==='retry_scheduled'?'failed':'pending',score:null,progress:{state,attempts:1,readyAhead:6,nextRetryAt:state==='queued'?null:1800000000000,hourlyLimit:120,capacityRemaining:state==='capacity_paused'?0:96,capacityResetsAt:1800000000000,providerPauseReason:'ai_provider_rate_limited'}}});
  await page.getByLabel('AI processing status').getByText(copy,{exact:false}).waitFor();assert.equal(writes.length,0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 }
});

test('processing capacity is collapsed, retains120default, and an explicit admin change carries the new bound',async t=>{
 const {page,writes}=await setup(t,{mode:'config',data:{enabled:true,configured:true,model:'openai/gpt-5-mini',provider:'OpenRouter / OpenAI',reviewOnly:true,hourlyLimit:120}});
 await page.getByRole('heading',{name:'AI connection'}).waitFor();assert.equal(await page.getByLabel('Maximum AI requests per hour').isVisible(),false);
 await page.getByText('Processing capacity',{exact:true}).click();const limit=page.getByLabel('Maximum AI requests per hour');assert.equal(await limit.inputValue(),'120');assert.equal(writes.length,0);
 await limit.fill('180');await page.getByRole('button',{name:'Save AI connection',exact:true}).click();await page.getByRole('status').filter({hasText:'AI review settings saved'}).waitFor();assert.deepEqual(writes,[{method:'PATCH',enabled:true,hourlyLimit:180}]);
});

test('non-owner admin sees capacity-only editing and cannot submit an unchanged connection form',async t=>{
 const {page,writes}=await setup(t,{mode:'config',data:{enabled:true,configured:true,model:'openai/gpt-5-mini',provider:'OpenRouter / OpenAI',reviewOnly:true,hourlyLimit:120,canManageConnection:false,canChangeCapacity:true}});
 const save=page.getByRole('button',{name:'Save processing capacity',exact:true});await save.waitFor();assert.equal(await save.isDisabled(),true);assert.equal(await page.getByRole('checkbox',{name:'Enable AI reviews'}).count(),0);assert.equal(await page.locator('input[type=password]').count(),0);
 await page.getByText('Processing capacity',{exact:true}).click();await page.getByLabel('Maximum AI requests per hour').fill('180');assert.equal(await save.isEnabled(),true);await save.click();await page.getByRole('status').filter({hasText:'AI review settings saved'}).waitFor();assert.deepEqual(writes,[{method:'PATCH',enabled:true,hourlyLimit:180}]);assert.equal(await save.isDisabled(),true);
});
