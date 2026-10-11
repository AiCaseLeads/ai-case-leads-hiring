import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const job={id:'job-1',title:'Synthetic Engineer',slug:'synthetic-engineer',location:'Remote · Spain',status:'open',fields:[],rules:[],formVersion:1,archiveCountry:'Spain',hiringRound:'Batch 2'};
const detail={id:'app-1',revision:1,name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',assignee:null,createdAt:Date.now(),updatedAt:Date.now(),source:'test',fields:[{path:'experience',title:'Experience',type:'LongText',required:false}],answers:[{path:'experience',value:'Synthetic role evidence'}],files:[{id:'file-1',filename:'synthetic-resume.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};
async function setup(t,mode){
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{CandidateDetail,Candidates}from'./components/hub/candidates';createRoot(document.getElementById('root')).render(${mode==='detail'?`<CandidateDetail id='app-1' changed={()=>{}} back={()=>{}}/>`:`<Candidates jobs={${JSON.stringify([job])}} refresh={0} changed={()=>{}} reviewerEmail='sales@example.invalid'/>`});`;
 const {outputFiles}=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const localChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(localChrome)?{executablePath:localChrome}:{})});const page=await browser.newPage({viewport:{width:390,height:844}});const queries=[];
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 await page.route('**/api/hub/applications**',route=>{queries.push(new URL(route.request().url()).search);return route.fulfill({json:{data:mode==='detail'?detail:{items:[detail],total:1,page:1,pageSize:50}}});});
 await page.route('**/api/scorecards*',route=>route.fulfill({json:{data:{template:null,revision:1}}}));
 await page.route('**/api/ai/config',route=>route.fulfill({json:{data:{configured:true,enabled:true,model:'synthetic',provider:'test',reviewOnly:true}}}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:mode==='detail'?'Synthetic Applicant':'Applications',exact:true}).waitFor();return {page,queries};
}
test('applicant record separates source files, review and activity without losing review drafts',async t=>{
 const {page}=await setup(t,'detail');
 assert.equal(await page.getByRole('heading',{name:'Application answers',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('heading',{name:'Evidence & verification',exact:true}).isVisible(),false);
 assert.equal(await page.getByRole('link',{name:'synthetic-resume.pdf'}).getAttribute('href'),'/api/files/file-1');
 await page.getByRole('tab',{name:'Application & files',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Review & scorecard',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
 await page.getByRole('tab',{name:'Review & scorecard',exact:true}).click();await page.getByText('Record verification checks',{exact:true}).click();await page.getByLabel('Evidence and follow-up notes',{exact:true}).fill('Unsaved synthetic follow-up');
 await page.getByRole('tab',{name:'Activity & messages',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Communication history',exact:true}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'Application answers',exact:true}).isVisible(),false);
 await page.getByRole('tab',{name:'Review & scorecard',exact:true}).click();assert.equal(await page.getByLabel('Evidence and follow-up notes',{exact:true}).inputValue(),'Unsaved synthetic follow-up');
 await page.getByLabel('Action',{exact:true}).selectOption('scorecard');assert.equal(await page.getByRole('tab',{name:'Review & scorecard',exact:true}).getAttribute('aria-selected'),'true');
});
test('application filters compare one posting and clear hidden filters together',async t=>{
 const {page,queries}=await setup(t,'list');assert.equal(await page.getByLabel('Order',{exact:true}).isDisabled(),true);
 assert.equal(await page.getByLabel('Job posting',{exact:true}).locator('option').allTextContents().then(a=>a.some(s=>s.includes('Batch'))),false);
 await page.getByLabel('Job posting',{exact:true}).selectOption('job-1');await page.getByLabel('Order',{exact:true}).selectOption('grade_desc');await page.getByText('More filters',{exact:true}).click();await page.getByLabel('Reviewer grades',{exact:true}).selectOption('reviewed');await page.getByLabel('Qualification rules',{exact:true}).selectOption('pass');
 await Promise.all([page.waitForResponse(r=>r.url().includes('sort=grade_desc')),page.getByRole('button',{name:'Apply filters',exact:true}).click()]);assert.ok(queries.some(q=>q.includes('jobId=job-1')&&q.includes('grade=reviewed')&&q.includes('qualification=pass')));
 await Promise.all([page.waitForResponse(r=>r.url().includes('/api/hub/applications?&page=1')),page.getByRole('button',{name:'Clear filters',exact:true}).click()]);assert.equal(await page.getByLabel('Job posting',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Reviewer grades',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Order',{exact:true}).isDisabled(),true);
});
