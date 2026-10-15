import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const job={id:'job-test',title:'Test engineer',slug:'engineer',status:'open',location:'Remote',fields:[],rules:[]};
const applicant={id:'app-test',name:'Synthetic Applicant',email:'applicant@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',createdAt:1,revision:1};
async function setup(t,{mode='candidate',data={status:'ready',score:80,criteria:[]},failWrite=false,width=390}={}){
 const view=mode==='candidate'?'<CandidateMatch applicationId="app-test"/>':mode==='setup'?'<JobMatchSetup jobId="job-test" changed={()=>{}}/>':`<Candidates jobs={${JSON.stringify([job])}} refresh={0} changed={()=>{}} reviewerEmail="reviewer@example.invalid"/>`;
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CandidateMatch,JobMatchSetup}from'./components/hub/ai-match';import{Candidates}from'./components/hub/candidates';createRoot(document.getElementById('root')).render(${view});`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 // Keep application CSS, excluding build-only Tailwind directives.
 const css=readFileSync('app/globals.css','utf8').replace(/^@import.*$/gm,'').replace(/^@tailwind.*$/gm,'');
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
 await page.route('**/api/hub/applications*',route=>{queries.push(new URL(route.request().url()).searchParams);return route.fulfill({json:{data:{items:[{...applicant,aiMatch:{status:'ready',score:80}},{...applicant,id:'app-pending',name:'Pending applicant',aiMatch:{status:'pending',score:null}}],total:2,page:1,pageSize:50}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 return {page,writes,queries,errors};
}

test('completed AI match shows job evidence, citations and uncertainty without replacing reviewer decisions',async t=>{
 const {page,errors}=await setup(t,{data:{status:'ready',score:83.6,model:'openai/test',sourceWarnings:['Portfolio file was not readable.'],criteria:[{criterion:'React experience',status:'evidence_found',explanation:'Resume describes React delivery.',citations:[{source:'resume:cv.pdf',quote:'Built React interfaces for 3 years.'}]},{criterion:'Team leadership',status:'needs_verification',explanation:'Clarify team size in interview.',citations:[]}]}});
 await page.getByText('84 / 100',{exact:true}).waitFor();assert.equal(await page.getByText('Built React interfaces for 3 years.',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText('Source: resume:cv.pdf',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText(/Needs clarification — Clarify team size/).isVisible(),true);
 assert.equal(await page.getByText('Portfolio file was not readable.',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText(/Missing evidence is not proof of missing ability/).isVisible(),true);
 assert.deepEqual(errors,[]);
});

test('pending, stale, failed and unreadable reviews never display misleading numeric scores',async t=>{
 for(const [status,label] of [['pending','Waiting for AI review'],['stale','Job changed · review needed'],['failed','AI review needs attention'],['needs_review','Needs manual review']]){
  const {page}=await setup(t,{data:{status,score:99,criteria:[],...(status==='failed'?{error:'Source extraction failed'}:{})}});
  await page.getByText(label,{exact:true}).waitFor();assert.equal(await page.getByText('99 / 100',{exact:true}).count(),0);
  if(status==='failed')assert.equal(await page.getByRole('alert').textContent(),'Source extraction failed');
 }
});

test('enabling one job is explicit and queues existing applicants only on request',async t=>{
 const {page,writes}=await setup(t,{mode:'setup',data:{jobId:job.id,version:1,enabled:false,status:'disabled',criteria:['React experience']}});
 const toggle=page.getByRole('checkbox',{name:'Automatically review applicants for this job'});await toggle.waitFor();assert.equal(await toggle.isChecked(),false);assert.equal(writes.length,0);
 assert.equal(await page.getByText(/Enabling this sends relevant résumé text and answers to OpenRouter/).isVisible(),true);
 await toggle.click();await page.getByRole('status').filter({hasText:'AI matching enabled'}).waitFor();assert.deepEqual(writes,[{method:'PATCH',jobId:job.id,enabled:true,expectedVersion:1,consent:true}]);
 await page.getByRole('button',{name:'Review existing applicants',exact:true}).click();await page.getByRole('status').filter({hasText:'Applications queued'}).waitFor();assert.deepEqual(writes[1],{method:'POST',jobId:job.id});
 await page.getByText('Requirements used for every applicant',{exact:true}).click();assert.equal(await page.getByText('React experience',{exact:true}).isVisible(),true);
 await toggle.click();await page.getByRole('status').filter({hasText:'Automatic AI matching is off'}).waitFor();assert.equal(writes[2].enabled,false);
});

test('failed enable stays off and explains the error instead of claiming success',async t=>{
 const {page,writes}=await setup(t,{mode:'setup',data:{jobId:job.id,version:1,enabled:false,status:'disabled',criteria:[]},failWrite:true});
 const toggle=page.getByRole('checkbox',{name:'Automatically review applicants for this job'});await toggle.click();await page.getByRole('alert').filter({hasText:'Provider unavailable'}).waitFor();assert.equal(await toggle.isChecked(),false);assert.equal(writes.length,1);assert.equal(await page.getByRole('button',{name:'Review existing applicants'}).count(),0);
});

test('AI sorting is scoped to a selected posting and clear filters removes it',async t=>{
 const {page,queries}=await setup(t,{mode:'list',data:{jobId:job.id,version:1,enabled:false,status:'disabled',criteria:[]}});
 const order=page.getByLabel('Order',{exact:true});await order.waitFor();assert.equal(await order.isDisabled(),true);
 await page.getByLabel('Job posting',{exact:true}).selectOption(job.id);await order.selectOption('ai_match_desc');
 await Promise.all([page.waitForResponse(r=>r.url().includes('sort=ai_match_desc')),page.getByRole('button',{name:'Apply filters',exact:true}).click()]);
 assert.equal(queries.at(-1).get('jobId'),job.id);assert.equal(queries.at(-1).get('sort'),'ai_match_desc');
 await page.getByRole('region',{name:'AI matching for this job'}).waitFor();await page.getByText('80 / 100',{exact:true}).waitFor();await page.getByText('Waiting for AI review',{exact:true}).waitFor();
 assert.equal(await page.getByText(/pending and outdated reviews stay unscored/).isVisible(),true);
 await Promise.all([page.waitForResponse(r=>r.url().includes('/api/hub/applications?&page=1')),page.getByRole('button',{name:'Clear filters',exact:true}).click()]);assert.equal(queries.at(-1).has('sort'),false);assert.equal(await order.isDisabled(),true);
 assert.equal(await page.getByRole('region',{name:'AI matching for this job'}).count(),0);
});

test('mobile AI evidence and consent remain within the viewport',async t=>{
 for(const mode of ['candidate','setup']){
  const {page}=await setup(t,{mode,data:{jobId:job.id,version:1,enabled:true,status:'ready',score:75,criteria:mode==='setup'?['Clear job requirement']:[{criterion:'Relevant experience',status:'evidence_found',explanation:'Application includes relevant work.',citations:[{source:'resume',quote:'Delivered customer projects.'}]}]}});
  await page.getByRole('heading',{name:mode==='setup'?'AI matching for this job':'AI job match',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
 }
});
