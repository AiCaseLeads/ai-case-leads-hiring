import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const jobs=[{id:'job-one',title:'Engineer',slug:'engineer',status:'open',location:'Remote · USA',archiveProject:'Engineering',archiveCountry:'USA',hiringRound:'October',fields:[],rules:[]},{id:'job-two',title:'Creative Strategist',slug:'creative',status:'closed',location:'Remote · Spain',archiveProject:'Creative',archiveCountry:'Spain',hiringRound:'September',fields:[],rules:[]}];
const applicant={id:'app-one',name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:'job-one',jobTitle:'Engineer',stage:'Application Review',qualification:'review',createdAt:1,revision:1,aiMatch:{status:'ready',score:90}};
async function setup(t,{width=390,initialJobId='',initialFilter='',total=75,pageSize=50}={}){
 const {outputFiles}=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Candidates}from'./components/hub/candidates';function App(){const [query,setQuery]=useState(${JSON.stringify(initialFilter || (initialJobId?'jobId='+initialJobId:''))});const [page,setPage]=useState(1);const p=new URLSearchParams(query);return <Candidates key={p.get("jobId")||"jobs"} onFilterChange={(q,p)=>{setQuery(q);setPage(p)}} initialPage={page} jobs={${JSON.stringify(jobs)}} refresh={0} changed={()=>{}} reviewerEmail="reviewer@example.invalid" initialJobId={p.get("jobId")||""} initialFilter={query} />};createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8')+'\n'+readFileSync('components/hub/applications.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main class="hub-main"><div id="root"></div></main><script src="/bundle.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(5000);const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const url=new URL(route.request().url());requests.push(url);let data={};if(url.pathname==='/api/hub/application-counts')data={items:[]};if(url.pathname==='/api/hub/applications')data={items:[{...applicant,id:Number(url.searchParams.get('page')||1)>1?'app-two':'app-one'}],total,page:Number(url.searchParams.get('page')||1),pageSize};if(url.pathname==='/api/ai/match')data={jobId:'job-one',enabled:false,available:true,status:'disabled',version:1,criteria:[]};return route.fulfill({json:{data}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);return{page,requests,errors};
}

test('Applications opens with jobs, not pooled candidates, and search includes closed postings',async t=>{
 const{page,requests,errors}=await setup(t);await page.getByRole('heading',{name:'Choose a job'}).waitFor();assert.equal(requests.filter(u=>u.pathname==='/api/hub/applications').length,0);assert.equal(await page.getByText(/Saved review queues/).count(),0);
 await page.getByLabel('Find a job').fill('Spain');assert.equal(await page.getByRole('button',{name:'View applications for Engineer'}).count(),0);await page.getByRole('button',{name:'View applications for Creative Strategist'}).waitFor();await page.getByLabel('Job status').selectOption('open');await page.getByText('No jobs found',{exact:true}).waitFor();assert.deepEqual(errors,[]);
});
test('Top 10 stays within one job and returning to jobs removes candidate table',async t=>{
 const{page,requests}=await setup(t);await page.getByRole('button',{name:'View applications for Engineer'}).click();await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 await page.getByRole('button',{name:'Top 10 AI matches',exact:true}).click();await page.getByRole('button',{name:'Show all applicants',exact:true}).waitFor();const query=requests.filter(u=>u.pathname==='/api/hub/applications').at(-1).searchParams;assert.equal(query.get('jobId'),'job-one');assert.equal(query.get('top'),'10');assert.equal(query.get('sort'),'ai_match_desc');
 await page.getByRole('button',{name:'All jobs',exact:true}).click();await page.getByRole('heading',{name:'Choose a job'}).waitFor();assert.equal(await page.getByRole('table',{name:'Applications',exact:true}).count(),0);
});
test('downloads include full filtered scope, selected IDs or all-job scope without a page cap',async t=>{
 const{page}=await setup(t,{initialJobId:'job-one',initialFilter:'jobId=job-one&sort=ai_match_desc&top=10'});const exports=[];await page.route('**/api/hub/applications-export?*',route=>{if(new URL(route.request().url()).searchParams.has('check'))exports.push(new URL(route.request().url()).searchParams);return route.fulfill(new URL(route.request().url()).searchParams.has('check')?{json:{data:{count:1}}}:{headers:{'Content-Disposition':'attachment; filename=applications.csv'},contentType:'text/csv',body:'id,name\napp-one,Synthetic Applicant'});});
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Download spreadsheet (CSV)',exact:true}).count(),0);await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).click();await page.getByText('Application files download started. Check your browser’s downloads for completion and the included PDF export report for unavailable files.',{exact:true}).waitFor();assert.equal(exports[0].get('jobId'),'job-one');assert.equal(exports[0].get('top'),'10');assert.equal(exports[0].has('page'),false);
 await page.getByLabel('Select Synthetic Applicant',{exact:true}).check();await page.getByLabel('Download scope').selectOption('selected');await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).click();await page.getByText(/Application files download started/).waitFor();assert.equal(exports[1].get('ids'),'app-one');assert.equal(exports[1].get('format'),'zip');
 await page.getByLabel('Download scope').selectOption('all');await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).click();await page.getByText('Application files download started. Check your browser’s downloads for completion and the included PDF export report for unavailable files.',{exact:true}).waitFor();assert.equal(exports[2].get('jobId'),'job-one');assert.equal(exports[2].has('top'),false);assert.equal(exports[2].has('ids'),false);
});
test('job chooser and applicant actions fit mobile and desktop',async t=>{
 for(const width of[320,390,768,1280,1728]){const{page}=await setup(t,{width});await page.getByRole('heading',{name:'Choose a job'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width]))));await page.getByRole('button',{name:'View applications for Engineer'}).click();await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width]))));}
});

test('job cards expose direct scoped downloads and page selection has an accessible checkbox',async t=>{
 const {page}=await setup(t,{width:1280});const exports=[];
 await page.route('**/api/hub/applications-export?*',route=>{const u=new URL(route.request().url());if(u.searchParams.has('check'))exports.push(u.searchParams);return route.fulfill(u.searchParams.has('check')?{json:{count:75}}:{headers:{'Content-Disposition':'attachment; filename=applications.zip'},body:'test'});});
 await page.getByRole('button',{name:'Download all applications ZIP for Engineer',exact:true}).click();await page.getByText(/Engineer: download started/).waitFor();assert.equal(exports[0].get('jobId'),'job-one');assert.equal(exports[0].get('format'),'zip');assert.equal(exports[0].has('page'),false);
 await page.getByRole('button',{name:'View applications for Engineer',exact:true}).click();await page.getByLabel('Select all applicants on this page',{exact:true}).check();assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'Select all matching for download (75)',exact:true}).click();assert.equal(await page.getByLabel('Download scope').inputValue(),'filtered');assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);await page.getByText(/75 matching applicants across all pages/).waitFor();
});

test('download controls align and wrap with production CSS at every supported width',async t=>{
 const {page}=await setup(t,{width:1728,initialJobId:'job-one'});await page.getByLabel('Download scope').waitFor();
 for(const width of [320,390,768,1280,1728]){
  await page.setViewportSize({width,height:900});
  const layout=await page.locator('.hub-download-actions').evaluate(row=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};return {row:rect(row),select:rect(row.querySelector('select')),buttons:[...row.querySelectorAll('button')].map(rect),overflow:[...row.querySelectorAll('button')].map(e=>e.scrollWidth>e.clientWidth+1),margin:getComputedStyle(row.querySelector('.hub-field')).marginBottom};});
  assert.equal(layout.margin,'0px');assert.ok(layout.select.left>=layout.row.left-1&&layout.select.right<=layout.row.right+1);assert.ok(layout.buttons.every(r=>r.left>=layout.row.left-1&&r.right<=layout.row.right+1),JSON.stringify(layout));assert.deepEqual(layout.overflow,[false]);
  if(width>=1280)for(const button of layout.buttons)assert.ok(Math.abs(button.bottom-layout.select.bottom)<=1,JSON.stringify(layout));
  if(width<=390)for(const button of layout.buttons)assert.ok(Math.abs(button.right-layout.row.right)<=1,JSON.stringify(layout));
 }
 await page.setViewportSize({width:320,height:900});await page.locator('.hub-download-actions button').first().evaluate(e=>{e.textContent='Download all application responses and original attachments for this particularly long job title';});await page.locator('.hub-application-downloads p').first().evaluate(e=>{e.textContent='Long guidance '+('application-reference-'.repeat(35));});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('.hub-download-actions button').first().evaluate(e=>e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1),true);
});


test('screening and inclusive date filters must apply before exporting all matching pages',async t=>{
 const{page,requests}=await setup(t,{width:1280,initialJobId:'job-one'});const exports=[];
 await page.route('**/api/hub/applications-export?*',route=>{const url=new URL(route.request().url());if(url.searchParams.has('check'))exports.push(url.searchParams);return route.fulfill(url.searchParams.has('check')?{json:{data:{count:75}}}:{headers:{'Content-Disposition':'attachment; filename=applications.zip'},body:'synthetic zip'});});
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 await page.getByLabel('Download scope').selectOption('all');
 await page.getByLabel('Screening',{exact:true}).selectOption('pass');
 await page.getByLabel('Applied from',{exact:true}).fill('2026-10-15');
 await page.getByLabel('Applied through',{exact:true}).fill('2026-10-18');
 assert.equal(await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.hub-download-actions button').disabled);
 assert.equal(await page.getByLabel('Download scope').inputValue(),'filtered');
 await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).click();
 await page.getByText(/Application files download started/).waitFor();
 assert.equal(exports.length,1);for(const key of ['qualification','appliedFrom','appliedTo','timeZone'])assert.equal(exports[0].get(key),requests.filter(url=>url.pathname==='/api/hub/applications').at(-1).searchParams.get(key));
 assert.equal(exports[0].get('qualification'),'pass');assert.equal(exports[0].get('appliedFrom'),'2026-10-15');assert.equal(exports[0].get('appliedTo'),'2026-10-18');assert.ok(exports[0].get('timeZone'));assert.equal(exports[0].has('page'),false);assert.equal(exports[0].has('ids'),false);
});

test('all matching selection spans 20 pages, checks visible boxes, survives refresh, and resets on filtering',async t=>{
 const{page}=await setup(t,{width:1280,initialJobId:'job-one',total:500,pageSize:25});
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 await page.getByRole('button',{name:'Select all matching for download (500)',exact:true}).click();
 assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 of 20 · 500 matching applicants',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);
 for(let index=3;index<=20;index++){await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText(`Page ${index} of 20 · 500 matching applicants`,{exact:true}).waitFor();assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);}
 await page.getByRole('button',{name:'Refresh applications',exact:true}).click();await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);assert.equal(await page.getByRole('button',{name:'Shortlist selected',exact:true}).count(),0);
 await page.getByLabel('Screening',{exact:true}).selectOption('pass');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 await page.getByText('Page 1 of 20 · 500 matching applicants',{exact:true}).waitFor();assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),false);assert.equal(await page.locator('.hub-selection-banner').count(),0);
});


test('switching away from AI order exits Top 10 before applying filters',async t=>{
 const{page,requests}=await setup(t,{width:1280,initialJobId:'job-one',initialFilter:'jobId=job-one&sort=ai_match_desc&top=10'});
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 for(const sort of ['newest','grade_desc']){
  await page.getByLabel('Order',{exact:true}).selectOption(sort);await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.hub-download-actions button').disabled);
  const query=requests.filter(url=>url.pathname==='/api/hub/applications').at(-1).searchParams;assert.equal(query.get('sort'),sort);assert.equal(query.has('top'),false);
  if(sort==='newest'){await page.getByRole('button',{name:'Top 10 AI matches',exact:true}).click();await page.getByRole('button',{name:'Show all applicants',exact:true}).waitFor();}
 }
});
