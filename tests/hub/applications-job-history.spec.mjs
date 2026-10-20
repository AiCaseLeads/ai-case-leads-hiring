import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const job={id:'job-1',title:'Synthetic Engineer',slug:'synthetic-engineer',location:'Remote · Spain',status:'open',fields:[],rules:[],formVersion:1,archiveCountry:'Spain',hiringRound:'Batch 2'};
const detail={id:'app-1',revision:1,name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',assignee:null,createdAt:Date.now(),updatedAt:Date.now(),source:'test',fields:[{path:'experience',title:'Experience',type:'LongText',required:false}],answers:[{path:'experience',value:'Synthetic role evidence'}],files:[{id:'file-1',filename:'synthetic-resume.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};

async function setup(t,query=''){
 let currentDetail=structuredClone(detail);
 const overview={counts:{applications:75,active:75,rejected:0,hired:0},stageCounts:[],recentApplications:[detail],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:[job]};
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={{email:'sales@example.invalid',role:'admin'}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});const page=await browser.newPage({viewport:{width:390,height:844}});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const queries=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());let data={};
  if(url.pathname==='/api/hub/application-counts')data={items:[]};
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
 await page.goto(`http://127.0.0.1:${server.address().port}/?view=applications${query}`);if(query.includes('jobId=job-1'))await page.getByRole('link',{name:'Synthetic Applicant',exact:true}).waitFor();return{page,queries};
}
test('job cards, applicant details and browser Back/Forward retain job, Top10 and filters',async t=>{
 const{page}=await setup(t);await page.getByRole('heading',{name:'Choose a job'}).waitFor();await page.getByRole('button',{name:'View applications for Synthetic Engineer'}).click();await page.getByRole('link',{name:'Synthetic Applicant',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('jobId'),'job-1');
 await page.getByRole('button',{name:'Top 10 AI matches',exact:true}).click();await page.getByRole('button',{name:'Show all applicants',exact:true}).waitFor();const jobUrl=page.url();assert.equal(new URL(jobUrl).searchParams.get('top'),'10');
 await page.getByRole('link',{name:'Synthetic Applicant',exact:true}).click();await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();await page.goBack();await page.getByRole('button',{name:'Show all applicants',exact:true}).waitFor();assert.equal(page.url(),jobUrl);
 await page.goForward();await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();await page.getByRole('button',{name:'Back to applications',exact:true}).click();await page.getByRole('button',{name:'Show all applicants',exact:true}).waitFor();assert.equal(page.url(),jobUrl);
 await page.getByRole('button',{name:'All jobs',exact:true}).click();await page.getByRole('heading',{name:'Choose a job'}).waitFor();assert.equal(new URL(page.url()).searchParams.has('jobId'),false);await page.goBack();await page.getByRole('button',{name:'Show all applicants',exact:true}).waitFor();assert.equal(page.url(),jobUrl);
});
