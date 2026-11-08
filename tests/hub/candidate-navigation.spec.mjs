import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const job={id:'job-1',title:'Synthetic Engineer',slug:'synthetic-engineer',location:'Remote · Spain',status:'open',fields:[],rules:[],formVersion:1,archiveCountry:'Spain',hiringRound:'Batch 2'};
const detail={id:'app-1',revision:1,name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',assignee:null,createdAt:Date.now(),updatedAt:Date.now(),source:'test',fields:[{path:'experience',title:'Experience',type:'LongText',required:false}],answers:[{path:'experience',value:'Synthetic role evidence'}],files:[{id:'file-1',filename:'synthetic-resume.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};
async function setup(t,mode){
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{CandidateDetail,Candidates}from'./components/hub/candidates';createRoot(document.getElementById('root')).render(${mode==='detail'?`<CandidateDetail id='app-1' changed={()=>{}} back={()=>{}}/>`:`<Candidates jobs={${JSON.stringify([job])}} refresh={0} changed={()=>{}} reviewerEmail='sales@example.invalid'/>`});`;
 const {outputFiles}=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',jsx:'automatic'});
 const css=['hub.css','applicant-queue.css','workspace-v3.css','workspace-surfaces.css','share-applicant.css'].map(name=>readFileSync('components/hub/'+name,'utf8')).join('\n');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div class="hiring-hub"><main class="hub-main"><div id="root"></div></main></div><script src="/bundle.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);const queries=[];
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const mocks={'/api/hub/meetgeek/meetings':[],'/api/hub/interview-recordings':[],'/api/hub/job-groups':{groups:[]},'/api/job-team':{staff:[]},'/api/hub/collections':{views:[],lists:[]}};
  return route.fulfill({json:{data:mocks[path]||{}}});
 });
 await page.route('**/api/hub/applications**',route=>{queries.push(new URL(route.request().url()).search);return route.fulfill({json:{data:mode==='detail'?detail:{items:[detail],total:1,page:1,pageSize:50}}});});
 await page.route('**/api/scorecards*',route=>route.fulfill({json:{data:{template:null,revision:1}}}));
 await page.route('**/api/ai/match*',route=>route.fulfill({json:{data:{enabled:false,status:'disabled',score:null,criteria:[]}}}));
 await page.route('**/api/ai/config',route=>route.fulfill({json:{data:{configured:true,enabled:true,model:'synthetic',provider:'test',reviewOnly:true}}}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:mode==='detail'?'Synthetic Applicant':'Applicants',exact:true}).waitFor();return {page,queries};
}
test('applicant record separates source files, review and activity without losing review drafts',async t=>{
 const {page}=await setup(t,'detail');
 assert.equal(await page.getByRole('heading',{name:'Application answers',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('heading',{name:'Evidence & verification',exact:true}).isVisible(),false);
 assert.equal(await page.getByRole('link',{name:/synthetic-resume\.pdf.*Download/}).getAttribute('href'),'/api/files/file-1');
 await page.getByRole('tab',{name:'Application & files',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Interviews & notes',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
 await page.getByRole('tab',{name:'Interviews & notes',exact:true}).click();await page.getByText('Advanced: evidence and verification tools',{exact:true}).click();await page.getByText('Record verification checks',{exact:true}).click();await page.getByLabel('Evidence and follow-up notes',{exact:true}).fill('Unsaved synthetic follow-up');
 await page.getByRole('tab',{name:'Activity & messages',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Messages',exact:true}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'Application answers',exact:true}).isVisible(),false);
 await page.getByRole('tab',{name:'Interviews & notes',exact:true}).click();assert.equal(await page.getByLabel('Evidence and follow-up notes',{exact:true}).inputValue(),'Unsaved synthetic follow-up');
 await page.getByLabel('More applicant actions',{exact:true}).click();await page.getByRole('button',{name:'Other applicant actions',exact:true}).click();await page.getByLabel('Action',{exact:true}).selectOption('scorecard');assert.equal(await page.getByRole('tab',{name:'Interviews & notes',exact:true}).getAttribute('aria-selected'),'true');
});
test('application filters compare a single posting and can clear filters independently of the posting',async t=>{
 const {page}=await setup(t,'list');
 const posting=page.getByLabel('Role or posting',{exact:true});
 const order=page.getByLabel('Order',{exact:true});
 const grades=page.getByLabel('Reviewer grades',{exact:true});
 const screening=page.getByLabel('Screening',{exact:true});
 const waitForApplicants=matches=>page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/api/hub/applications' && matches(url.searchParams);
 });
 assert.ok(!(await posting.locator('option').allTextContents()).some(label=>label.includes('Batch')));
 await page.getByRole('button',{name:'Filters & order'}).click();
 assert.equal(await order.locator('option[value="grade_desc"]').count(),0);
 await posting.selectOption('job:job-1');
 await order.selectOption('grade_desc');
 await page.getByText('More filters',{exact:true}).click();
 await grades.selectOption('reviewed');
 await Promise.all([waitForApplicants(q=>q.get('jobId')===job.id&&q.get('grade')==='reviewed'&&q.get('sort')==='grade_desc'&&q.get('qualification')==='pass'),screening.selectOption('pass')]);
 await Promise.all([waitForApplicants(q=>q.get('jobId')===job.id&&!q.has('grade')&&!q.has('qualification')&&q.get('sort')==='screening_newest'),page.getByRole('button',{name:'Clear filters',exact:true}).click()]);
 assert.equal(await posting.inputValue(),'job:job-1');
 assert.equal(await grades.inputValue(),'');
 assert.equal(await screening.inputValue(),'');
 await Promise.all([waitForApplicants(q=>!q.has('jobId')),page.getByRole('button',{name:'Remove filter: '+job.title,exact:true}).click()]);
 assert.equal(await posting.inputValue(),'');
 assert.equal(await order.locator('option[value="grade_desc"]').count(),0);
});
