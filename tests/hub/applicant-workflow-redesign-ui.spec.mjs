import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const job={id:'job-one',title:'Synthetic Engineer',slug:'synthetic-engineer',status:'open',location:'Remote · USA',fields:[],rules:[],aiMatchEnabled:true};
const applicant={id:'app-one',name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'review',createdAt:1,revision:4,assignee:null,aiMatch:{status:'ready',score:88}};
const details={...applicant,answers:[{path:'years',value:7}],fields:[{path:'years',title:'Years of experience',type:'Number'}],files:[],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};
const review={status:'ready',score:88,criteria:[{criterion:'React delivery',status:'evidence_found',explanation:'Built production React apps for seven years.',citations:[{source:'resume:cv.pdf',quote:'Seven years shipping React applications.'}]},{criterion:'Team leadership',status:'needs_verification',explanation:'Ask how many people they led and what they owned.',citations:[]}]};
const readiness={sender:'recruiter@example.invalid',mailReady:true,mailIssue:null,sharedCalendarReady:true,hasActiveInterview:false,renewCalendarReady:false,interviewers:[{email:'recruiter@example.invalid',ready:true}]};
let assets;
async function getAssets(){
 if(!assets)assets=(async()=>{
  const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Candidates,CandidateDetail}from'./components/hub/candidates';import{CandidateMatch}from'./components/hub/ai-match';const config=window.__fixture;createRoot(document.getElementById('root')).render(config.mode==='review'?<CandidateMatch applicationId="app-one"/>:config.mode==='detail'?<CandidateDetail id="app-one" back={()=>{}} changed={()=>{}}/>:<Candidates jobs={config.jobs} refresh={0} changed={()=>{}} reviewerEmail="owner@example.invalid" initialJobId="job-one" initialFilter="jobId=job-one"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
  const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8');
  return{js:outputFiles[0].text,css};
 })();
 return assets;
}
async function setup(t,{mode='list',screening=false,mailReady=true,failShortlist=false,hasActiveInterview=false,renewCalendarReady=false,width=1280}={}){
 const{js,css}=await getAssets();
 const jobs=[{...job,rules:screening?[{fieldPath:'years',enabled:true,operator:'gte',value:8,reason:'Eight years required'}]:[]}];
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?js:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div class="hiring-hub"><aside class="hub-sidebar">Synthetic workspace</aside><div class="hub-workspace"><main class="hub-main"><div id="root"></div></main></div></div><script>window.__fixture=${JSON.stringify({mode,jobs})}</script><script src="/bundle.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(5000);const writes=[],errors=[],queries=[];let current=structuredClone(details);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.pathname==='/api/hub/applications'&&request.method()==='GET')queries.push(url.searchParams);
  if(request.method()!=='GET'){
   const body=request.postDataJSON();writes.push({path:url.pathname,body});
   if(body.action==='stage'&&failShortlist)return route.fulfill({status:409,json:{error:{message:'This application changed. Refresh before trying again.'}}});
   if(body.action==='stage'){await new Promise(resolve=>setTimeout(resolve,100));current={...current,stage:body.stage,revision:current.revision+1};}
   if(body.action==='interview')current={...current,stage:'Interview',revision:current.revision+1};
   return route.fulfill({json:{data:current}});
  }
  let data={};
  if(url.pathname==='/api/hub/applications')data={items:[current],total:75,page:1,pageSize:25};
  if(url.pathname==='/api/hub/applications/app-one')data=current;
  if(url.pathname==='/api/ai/match')data=url.searchParams.has('applicationId')?review:{enabled:true,jobId:job.id,version:1,available:true,status:'ready',criteria:['React delivery','Team leadership']};
  if(url.pathname==='/api/interview-readiness')data={...readiness,hasActiveInterview,renewCalendarReady,mailReady,mailIssue:mailReady?null:'recruiter_email_not_connected'};
  if(url.pathname==='/api/hub/applications-export')data={count:75};
  return route.fulfill({json:{data}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);return{page,writes,errors,queries};
}

test('screening state explains no rules and missing answers while AI match stays independent',async t=>{
 for(const screening of [false,true]){
  const{page,errors}=await setup(t,{screening});await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
  await page.getByText(screening?'Check answers':'No screening rules',{exact:true}).waitFor();
  assert.equal(await page.getByRole('columnheader',{name:'Reviewer grade',exact:true}).count(),0);
  assert.equal(await page.getByText('Needs review',{exact:true}).count(),0);
  await page.getByRole('cell',{name:'New',exact:true}).waitFor();await page.getByText('88 / 100',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
 }
});

test('shortlist is one explicit revision-safe action and repeated clicks do not duplicate it',async t=>{
 const{page,writes}=await setup(t);const shortlist=page.getByRole('button',{name:'Shortlist Synthetic Applicant',exact:true});await shortlist.waitFor();
 await shortlist.evaluate(element=>{element.click();element.click();});
 await page.getByRole('cell',{name:'Shortlisted',exact:true}).waitFor();
 assert.deepEqual(writes,[{path:'/api/hub/applications/app-one/action',body:{action:'stage',stage:'Screening',expectedRevision:4}}]);
 assert.equal(await page.getByRole('button',{name:'Shortlist Synthetic Applicant',exact:true}).count(),0);
});

test('stale shortlist fails visibly and preserves the displayed stage',async t=>{
 const{page,writes}=await setup(t,{failShortlist:true});await page.getByRole('button',{name:'Shortlist Synthetic Applicant',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'This application changed'}).waitFor();await page.getByRole('cell',{name:'New',exact:true}).waitFor();assert.equal(writes.length,1);
});

test('request interview opens setup without sending and sends only after a ready calendar is chosen',async t=>{
 const{page,writes}=await setup(t);await page.getByRole('button',{name:'Request interview with Synthetic Applicant',exact:true}).click();
 await page.getByRole('heading',{name:'Synthetic Applicant',exact:true}).waitFor();const send=page.getByRole('button',{name:'Send booking link',exact:true});await send.waitFor();assert.equal(writes.length,0);assert.equal(await send.isDisabled(),true);
 await page.getByLabel('Who will conduct this interview?',{exact:true}).selectOption('recruiter@example.invalid');await send.waitFor();assert.equal(await send.isEnabled(),true);await send.click();
 await page.getByRole('status').filter({hasText:'Decision saved'}).waitFor();assert.deepEqual(writes,[{path:'/api/hub/applications/app-one/action',body:{action:'interview',expectedRevision:4,renew:false,interviewerEmail:'recruiter@example.invalid'}}]);
});

test('disconnected recruiter mail blocks interview send and provides the next setup step',async t=>{
 const{page,writes}=await setup(t,{mailReady:false});await page.getByRole('button',{name:'Request interview with Synthetic Applicant',exact:true}).click();await page.getByLabel('Who will conduct this interview?',{exact:true}).selectOption('recruiter@example.invalid');
 await page.getByText(/needs to connect their recruiting email in Settings/).waitFor();assert.equal(await page.getByRole('button',{name:'Send booking link',exact:true}).isDisabled(),true);assert.equal(writes.length,0);
});

test('AI overview prioritizes strengths and questions while exact quotes remain available on demand',async t=>{
 const{page,writes}=await setup(t,{mode:'review'});await page.getByText('1 of 2 requirements supported',{exact:true}).waitFor();await page.getByRole('heading',{name:'Relevant strengths'}).waitFor();await page.getByRole('heading',{name:'What to clarify'}).waitFor();
 assert.equal(await page.getByText('Seven years shipping React applications.',{exact:true}).isVisible(),false);
 await page.locator('.hub-match-source-evidence > summary').click();await page.getByText('Seven years shipping React applications.',{exact:true}).waitFor();await page.getByText('Source: resume:cv.pdf',{exact:true}).waitFor();assert.equal(writes.length,0);
});

test('compact toolbar and disclosed downloads fit mobile and desktop with compiled production CSS',async t=>{
 const{page,errors}=await setup(t);await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();assert.equal(await page.getByLabel('Download scope').isVisible(),false);
 for(const width of [320,390,768,1280,1728]){
  await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right]))));
  await page.locator('.hub-download-menu > summary').click();await page.getByLabel('Download scope').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right]))));
  await page.locator('.hub-download-menu > summary').click();
 }
 assert.deepEqual(errors,[]);
});


test('pipeline stages preserve search and ranking within the selected job',async t=>{
 const{page,queries}=await setup(t);await page.getByLabel('Search',{exact:true}).fill('Synthetic');await page.getByLabel('Order',{exact:true}).selectOption('ai_match_desc');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 await page.getByRole('button',{name:'Shortlisted',exact:true}).click();await page.waitForResponse(response=>response.url().includes('stage=Screening'));
 const filters=queries.at(-1);assert.equal(filters.get('jobId'),'job-one');assert.equal(filters.get('q'),'Synthetic');assert.equal(filters.get('sort'),'ai_match_desc');assert.equal(filters.get('stage'),'Screening');
 assert.equal(await page.getByRole('button',{name:'Shortlisted',exact:true}).getAttribute('aria-pressed'),'true');
});

test('shortlist selected updates only explicit selected records with their revisions',async t=>{
 const{page,writes}=await setup(t);await page.getByLabel('Select Synthetic Applicant',{exact:true}).check();await page.getByRole('button',{name:'Shortlist selected',exact:true}).click();
 await page.getByRole('status').filter({hasText:'1 applicants added to the shortlist'}).waitFor();
 assert.deepEqual(writes,[{path:'/api/hub/bulk',body:{ids:['app-one'],expectedRevisions:{'app-one':4},action:'stage',stage:'Screening'}}]);
});


test('replacement interview cannot bypass missing or disconnected original calendar readiness',async t=>{
 for(const hasActiveInterview of [false,true]){
  const{page,writes}=await setup(t,{hasActiveInterview,renewCalendarReady:false});await page.getByRole('button',{name:'Request interview with Synthetic Applicant',exact:true}).click();await page.getByLabel('Who will conduct this interview?',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:/Send a replacement secure link/}).check();await page.getByText(hasActiveInterview?'The original interviewer needs to reconnect their calendar and save availability before sending a replacement link.':'No active interview to replace. Turn off replacement mode and choose an interviewer.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Send booking link',exact:true}).isDisabled(),true);assert.equal(writes.length,0);
 }
});
