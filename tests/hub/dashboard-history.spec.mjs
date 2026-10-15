import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const job={id:'job-1',title:'Synthetic Engineer',slug:'synthetic-engineer',location:'Remote · Spain',status:'open',fields:[],rules:[],formVersion:1,archiveCountry:'Spain',hiringRound:'Batch 2'};
const detail={id:'app-1',revision:1,name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',assignee:null,createdAt:Date.now(),updatedAt:Date.now(),source:'test',fields:[{path:'experience',title:'Experience',type:'LongText',required:false}],answers:[{path:'experience',value:'Synthetic role evidence'}],files:[{id:'file-1',filename:'synthetic-resume.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};

async function setup(t,query='&jobId=job-1'){
 let currentDetail=structuredClone(detail);const drafts=new Map();
 const overview={counts:{applications:75,active:75,rejected:0,hired:0},stageCounts:[],recentApplications:[detail],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:[job]};
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={{email:'sales@example.invalid',role:'admin'}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});const page=await browser.newPage({viewport:{width:390,height:844}});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const queries=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());let data={};
  if(url.pathname==='/api/hub/application-counts')data={items:[]};
  if(url.pathname==='/api/job-drafts'){if(route.request().method()==='GET')data=url.searchParams.has('key')?(drafts.get(url.searchParams.get('key'))||null):[];else {const input=route.request().postDataJSON();data={key:input.key,revision:1,updatedAt:Date.now(),state:input.state};drafts.set(input.key,data);}}
  if(url.pathname==='/api/hub/overview')data=overview;
  if(url.pathname==='/api/hub/applications'){queries.push(url.search);data={items:url.searchParams.get('stage')&&url.searchParams.get('stage')!==currentDetail.stage?[]:[currentDetail],total:75,page:Number(url.searchParams.get('page')||1),pageSize:25};}
  if(url.pathname==='/api/hub/applications/app-1')data=currentDetail;
  if(url.pathname==='/api/hub/applications/app-1/action'){currentDetail={...currentDetail,revision:currentDetail.revision+1,stage:route.request().postDataJSON().stage};data=currentDetail;}
  if(url.pathname==='/api/scorecards')data={template:null,revision:0,templates:[],archived:[],bindings:{}};
  if(url.pathname==='/api/hub/jobs')data=[job];
  if(url.pathname==='/api/job-setup')data={revision:0,templates:[],requests:[],locations:{}};
  if(url.pathname==='/api/job-team')data={config:null,staff:[{email:'sales@example.invalid',role:'admin'}],sender:'sales@example.invalid'};
  if(url.pathname==='/api/ai/config')data={configured:false,enabled:false,reviewOnly:true};
  if(url.pathname==='/api/review-reminders')data={total:0,applications:[],staff:[],config:{enabled:false,dueHours:48,fallbackAdmins:[]}};
  return route.fulfill({json:{data}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/?view=applications${query}`);if(query.includes('jobId=job-1'))await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();else await page.getByRole('heading',{name:'Choose a job',exact:true}).waitFor();return{page,queries};
}
test('candidate browser Back and in-app Back restore exact filter, page and Home origin',async t=>{
 const {page}=await setup(t);await page.getByLabel('Search',{exact:true}).fill('Synthetic');await page.getByLabel('Stage',{exact:true}).selectOption('Application Review');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 · 75 total',{exact:true}).waitFor();const queueUrl=page.url();
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).click();await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('application'),'app-1');
 await page.goBack();await page.getByRole('heading',{name:'Synthetic Engineer',exact:true}).waitFor();assert.equal(page.url(),queueUrl);assert.equal(await page.getByLabel('Search',{exact:true}).inputValue(),'Synthetic');assert.equal(new URL(page.url()).searchParams.get('jobId'),job.id);assert.equal(await page.getByLabel('Stage',{exact:true}).inputValue(),'Application Review');await page.getByText('Page 2 · 75 total',{exact:true}).waitFor();
 await page.goForward();await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();await page.getByRole('button',{name:'Back to applications',exact:true}).click();await page.getByText('Page 2 · 75 total',{exact:true}).waitFor();assert.equal(page.url(),queueUrl);
 await page.getByRole('navigation',{name:'Hiring workspace'}).getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('heading',{name:'What needs your attention?'}).waitFor();await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).click();await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();await page.getByRole('button',{name:'Back to applications',exact:true}).click();await page.getByRole('heading',{name:'What needs your attention?'}).waitFor();
});
test('direct filters validate deleted job references and normalize invalid page numbers',async t=>{
 const {page,queries}=await setup(t,'&jobId=deleted&sort=grade_desc&grade=reviewed&page=Infinity');
 await page.getByRole('heading',{name:'Choose a job',exact:true}).waitFor();assert.equal(await page.getByLabel('Order',{exact:true}).count(),0);assert.equal(queries.length,0);
 await page.goto(new URL('/?view=applications&jobId=job-1&page=2.9',page.url()).href);await page.getByText('Page 2 · 75 total',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('jobId'),job.id);
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByText('Page 1 · 75 total',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('jobId'),job.id);
 await page.goBack();await page.getByText('Page 2 · 75 total',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('jobId'),job.id);
});

test('the Home create shortcut keeps drafts through browser Back and Forward',async t=>{
 const {page}=await setup(t);await page.getByRole('navigation',{name:'Hiring workspace'}).getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Unsaved Home draft');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Unsaved Home draft');await page.goForward();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Hiring workspace'}).getByRole('button',{name:'Jobs',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Save draft & leave',exact:true}).click();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Tell applicants about the job',exact:true}).waitFor();assert.equal(await page.getByLabel('Job title',{exact:true}).inputValue(),'Unsaved Home draft');
});

test('direct applicant link Back returns applications rather than Home',async t=>{const{page}=await setup(t);await page.goto(new URL('/?application=app-1',page.url()).href);await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();await page.getByRole('button',{name:'Back to applications',exact:true}).click();await page.getByRole('heading',{name:'Choose a job',exact:true}).waitFor({timeout:2500});});

test('returning after a candidate stage change clears stale bulk selections and approval',async t=>{
 const{page}=await setup(t,'&jobId=job-1&stage=Application%20Review');
 await page.getByLabel('Select Synthetic Applicant',{exact:true}).check();await page.getByLabel('Bulk action',{exact:true}).selectOption('reject');await page.getByLabel('I approve these rejections and their rejection emails.',{exact:true}).check();
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).click();await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();await page.getByLabel('Action',{exact:true}).selectOption('stage');await page.getByRole('region',{name:'Synthetic Applicant',exact:true}).getByLabel('Stage',{exact:true}).selectOption('Screening');await page.getByRole('button',{name:'Save action',exact:true}).click();await page.getByText('Saved to this application.',{exact:true}).waitFor();await page.getByRole('button',{name:'Back to applications',exact:true}).click();await page.getByRole('heading',{name:'No applications in this view',exact:true}).waitFor();assert.equal(await page.getByLabel('Bulk action',{exact:true}).count(),0);assert.equal(await page.getByText('1 selected',{exact:true}).count(),0);
});
