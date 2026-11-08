import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const jobs=[{id:'job-one',title:'Engineer',slug:'engineer',status:'open',location:'Remote · USA',archiveProject:'Engineering',archiveCountry:'USA',hiringRound:'October',fields:[],rules:[]},{id:'job-two',title:'Creative Strategist',slug:'creative',status:'closed',location:'Remote · Spain',archiveProject:'Creative',archiveCountry:'Spain',hiringRound:'September',fields:[],rules:[]}];
const applicant={id:'app-one',name:'Synthetic Applicant',email:'synthetic@example.invalid',jobId:'job-one',jobTitle:'Engineer',stage:'Application Review',qualification:'review',createdAt:1,revision:1,aiMatch:{status:'ready',score:90}};
async function setup(t,{width=390,initialJobId='',initialFilter='',total=75,pageSize=30,dashboard=false}={}){
 const dashboardEntry=`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={{email:'reviewer@example.invalid',role:'admin'}} signOutHref='/logout'/>);`;
 const {outputFiles}=await build({stdin:{contents:dashboard?dashboardEntry:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Candidates}from'./components/hub/candidates';function App(){const [query,setQuery]=useState(${JSON.stringify(initialFilter || (initialJobId?'jobId='+initialJobId:''))});const [page,setPage]=useState(1);const p=new URLSearchParams(query);return <Candidates key={p.get("jobId")||"jobs"} onFilterChange={(q,p)=>{setQuery(q);setPage(p)}} initialPage={page} jobs={${JSON.stringify(jobs)}} refresh={0} changed={()=>{}} reviewerEmail="reviewer@example.invalid" initialJobId={p.get("jobId")||""} initialFilter={query} />};createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',jsx:'automatic'});
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8')+'\n'+readFileSync('components/hub/applications.css','utf8')+'\n'+readFileSync('components/hub/applicant-queue.css','utf8')+'\n'+readFileSync('components/hub/workspace-v3.css','utf8')+'\n'+readFileSync('components/hub/workspace-surfaces.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${dashboard?'<div id="root"></div>':'<main class="hub-main"><div id="root"></div></main>'}<script src="/bundle.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(5000);const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const selection=Array.from({length:total},(_,i)=>({id:'app-'+i,stage:'Application Review',revision:1}));
 const writes=[];
 await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());requests.push(url);
   if(request.method()==='POST')writes.push({path:url.pathname,body:request.postDataJSON()});
   const n=Number(url.searchParams.get('page')||1);let data={};
   if(url.pathname==='/api/hub/applications')data={items:selection.slice((n-1)*pageSize,n*pageSize).map(i=>({...applicant,...i,name:'Synthetic '+i.id})),total,scopeTotal:total+8,page:n,pageSize};
   if(url.pathname==='/api/hub/job-groups')data={groups:[{id:'g1',name:'Regional hiring',jobIds:['job-one','job-two']}]};
   if(url.pathname==='/api/hub/collections')data=[];
   if(url.pathname==='/api/job-team')data={staff:[{email:'reviewer@example.invalid'}]};
   if(url.pathname==='/api/hub/application-selections')data={selectionId:'snapshot',items:selection};
   if(url.pathname==='/api/hub/bulk-rejection/preview')data={planId:'preview-id',count:60,recipients:55,excluded:15,expiresAt:Date.now()+90000};
   if(url.pathname==='/api/ai/match')data={jobId:'job-one',enabled:false,available:true,status:'disabled',version:1,criteria:[]};
   if(url.pathname==='/api/hub/applications-export'){
     if(url.searchParams.has('check'))return route.fulfill({json:{count:total,format:'zip'}});
     return route.fulfill({body:'fixture download',headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=fixture.zip'}});
   }
   if(dashboard)data=dashboardFixture(url)??data;
   return route.fulfill({json:{data}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+(dashboard?'/?view=applications'+(initialFilter?'&'+initialFilter:''):''));
 if(!dashboard)await page.getByRole('link',{name:'Synthetic app-0',exact:true}).waitFor();
 return{page,requests,writes,errors};
}
test('cross-role queue, independent filters, scoped sorts, country chips and role links fit phone to wide desktop',async t=>{
 for(const width of [320,390,768,1280,1728]){
  const {page,requests,errors}=await setup(t,{width});
  await page.getByRole('heading',{name:'Applicants',exact:true}).waitFor();
  assert.ok(await page.getByText('75 of 83 applications · All roles').isVisible());
  assert.ok(!(await page.getByRole('link',{name:'Synthetic app-0',exact:true}).getAttribute('href')).includes('jobId='));
  await page.getByRole('button',{name:'Filters & order'}).click();
  await page.getByLabel('Stage',{exact:true}).selectOption('stage:Screening');
  await page.getByLabel('Interview',{exact:true}).selectOption('awaiting_booking');
  await page.getByLabel('Owner',{exact:true}).selectOption('reviewer@example.invalid');
  await page.getByLabel('Screening',{exact:true}).selectOption('pass');
  await page.getByText('More filters',{exact:true}).click();
  await page.getByLabel('Country of residence').selectOption('IN');
  await page.getByLabel('Country of residence').selectOption('PK');
  await page.getByLabel('Applied from',{exact:true}).fill('2026-10-15');
  await page.getByRole('button',{name:'Remove filter: Pakistan'}).waitFor();await page.getByRole('link',{name:'Synthetic app-0',exact:true}).waitFor();
  const query=requests.filter(u=>u.pathname==='/api/hub/applications').at(-1).searchParams;
  assert.equal(query.get('stage'),'Screening');assert.equal(query.get('interviewProgress'),'awaiting_booking');
  assert.equal(query.get('assignee'),'reviewer@example.invalid');assert.equal(query.get('qualification'),'pass');assert.equal(query.get('country'),'IN,PK');assert.equal(query.get('appliedFrom'),'2026-10-15');
  assert.equal(await page.getByLabel('Order',{exact:true}).locator('option[value="ai_match_desc"]').count(),0);
  await page.getByLabel('Role or posting').selectOption('job:job-one');
  await page.getByRole('heading',{name:'Engineer',exact:true}).waitFor();
  if(!await page.getByLabel('Order',{exact:true}).isVisible())await page.getByRole('button',{name:'Filters & order'}).click();
  await page.getByLabel('Order',{exact:true}).selectOption('ai_match_desc');await page.getByRole('link',{name:'Synthetic app-0',exact:true}).waitFor();
  const href=await page.getByRole('link',{name:'Synthetic app-0',exact:true}).getAttribute('href');assert.ok(href.includes('jobId=job-one'));assert.ok(href.includes('country=IN%2CPK'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow at '+width);assert.deepEqual(errors,[]);
 }
});

test('select all spans pages, freezes export scope and requires an eligible recipient preview',async t=>{
 const {page,requests,writes}=await setup(t,{width:390});
 await page.getByRole('button',{name:'Select applications',exact:true}).click();await page.getByRole('button',{name:'Select all 75 matching',exact:true}).click();
 await page.getByText('75 selected · all matching',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('link',{name:'Synthetic app-30',exact:true}).waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'Select Synthetic app-30',exact:true}).isChecked(),true);
 await page.getByLabel('Apply to 75 selected').selectOption('download');
 await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download 75 applications (ZIP)'}).click()]);
 const check=requests.find(u=>u.pathname==='/api/hub/applications-export'&&u.searchParams.has('check'));assert.equal(check.searchParams.get('selectionId'),'snapshot');assert.equal(check.searchParams.has('jobId'),false);
 await page.getByLabel('Apply to 75 selected').selectOption('reject');await page.getByRole('button',{name:'Preview rejection for 75 selected'}).click();
 await page.getByText(/60 eligible applications · 60 rejection emails to 55 distinct addresses · 15 selected applications excluded/).waitFor();
 assert.equal(writes.find(x=>x.path.endsWith('/preview')).body.selectionId,'snapshot');assert.equal(writes.some(x=>x.path.endsWith('/execute')),false);
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Reject 60 and queue emails'}).count(),0);
});

test('selected rows from different pages are assigned once and use their original revisions',async t=>{
 const {page,writes}=await setup(t,{width:1280});
 await page.getByRole('checkbox',{name:'Select Synthetic app-0',exact:true}).check();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('checkbox',{name:'Select Synthetic app-30',exact:true}).check();
 await page.getByLabel('Apply to 2 selected').selectOption('assign');await page.getByLabel('New owner').selectOption('reviewer@example.invalid');await page.getByRole('button',{name:'Update 2 applications'}).click();
 await page.getByText('2 of 2 applications updated.').waitFor();
 assert.deepEqual(writes.find(w=>w.path==='/api/hub/bulk').body,{ids:['app-0','app-30'],expectedRevisions:{'app-0':1,'app-30':1},action:'assign',assignee:'reviewer@example.invalid'});
});

test('column choices and direct ZIP downloads retain the explicit cross-role scope',async t=>{
  const {page,requests,writes}=await setup(t,{width:1280});
  await page.getByLabel('Application options').click();
  await page.getByRole('checkbox',{name:'Show AI job match column',exact:true}).uncheck();
  await page.getByRole('link',{name:'Synthetic app-0',exact:true}).waitFor();
  assert.equal(await page.getByRole('columnheader',{name:/AI job match/}).count(),0);
  const link=await page.getByRole('link',{name:'Synthetic app-0',exact:true}).getAttribute('href');
  assert.equal(new URL(link,'https://jobs.test').searchParams.get('columns'),'screening,owner,applied');
  await Promise.all([page.waitForResponse(r=>r.url().includes('applications-export')&&r.url().includes('check=1')),page.getByRole('button',{name:'Download matching ZIP (75)'}).click()]);
  assert.ok(writes.some(w=>w.path==='/api/hub/application-selections'));
  assert.ok(requests.some(req=>req.pathname==='/api/hub/applications-export'&&req.searchParams.get('selectionId')==='snapshot'));
});


const roleJobs=[jobs[0],jobs[1],{...jobs[0],id:'job-east',title:'Eastern recruiter'}, {...jobs[0],id:'job-west',title:'Western recruiter'}];
const roleGroup={id:'recruiting',kind:'role',name:'Recruiter',jobIds:['job-east','job-west','job-two']};
const roleItems=[
  {...applicant,name:'Initial Engineer'},
  {...applicant,id:'app-screened',name:'Shortlisted Engineer',stage:'Screening'},
  {...applicant,id:'app-east',name:'Eastern Applicant',jobId:'job-east',jobTitle:'Eastern recruiter'},
  {...applicant,id:'app-west',name:'Western Applicant',jobId:'job-west',jobTitle:'Western recruiter'},
  {...applicant,id:'app-closed',name:'Closed Posting Applicant',jobId:'job-two',jobTitle:'Creative Strategist'},
];

function dashboardFixture(url){
  const filters=url.searchParams;
  switch(url.pathname){
    case '/api/hub/overview':
      return {counts:{applications:5,active:5,rejected:0,hired:0},stageCounts:[],recentApplications:[],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:roleJobs};
    case '/api/hub/jobs': return roleJobs;
    case '/api/hub/workflow/overview':
      return {canApprove:false,reviewQueue:[],myQueue:[],unassigned:[],returned:[],counts:{awaitingReview:0,myUnreviewed:0,unassigned:0,returned:0}};
    case '/api/hub/applicant-roles':
      return {roles:[{name:'Engineer',jobId:'job-one',locations:['United States'],reviewCount:1,postingCount:1},{name:'Recruiter',jobGroupId:'recruiting',locations:['Spain','United States'],reviewCount:2,postingCount:2}]};
    case '/api/hub/job-groups': return {groups:[roleGroup],postings:[],revision:0};
    case '/api/hub/applications': {
      const items=roleItems.filter(a=>(!filters.has('jobId') || a.jobId===filters.get('jobId'))&&
        (!filters.has('jobGroupId')||roleGroup.jobIds.includes(a.jobId))&&
        (filters.get('openPostings')!=='true'||a.jobId!=='job-two')&&(!filters.has('stage')||a.stage===filters.get('stage')));
      return {items,total:items.length,scopeTotal:items.length,page:1,pageSize:30};
    }
    case '/api/hub/applications/app-one':
      return {...roleItems[0],fields:[],answers:[],files:[],history:[],notes:[],communications:[],scorecards:[],qualificationEvidence:[]};
    case '/api/hub/applications/app-one/navigation': return {nextId:null,previousId:null,total:1,index:1};
    case '/api/hub/applications/app-one/response-checks': return {status:'ready',entry:null,answers:[]};
    case '/api/scorecards': return {template:null,revision:0,templates:[],archived:[],bindings:{}};
    case '/api/review-reminders': return {total:0,applications:[],staff:[],config:{enabled:false,dueHours:48,fallbackAdmins:[]}};
  }
}
test('Applicants opens active roles before loading people and preserves role and stage through profile navigation',async t=>{
  for(const width of [320,1280]){
    const {page,requests,errors}=await setup(t,{dashboard:true,width});
    const roleDirectory=page.getByRole('heading',{name:'Active roles',exact:true});
    await roleDirectory.waitFor();
    const role=page.getByRole('link',{name:/Engineer/});
    await role.waitFor();
    const artifacts=process.env.HUB_LAYOUT_ARTIFACTS;
    if(artifacts){mkdirSync(artifacts,{recursive:true});await page.locator('.hub-main').screenshot({path:artifacts+'/active-roles-'+width+'.png'});}
    assert.equal(await page.getByRole('link',{name:/Creative Strategist/}).count(),0);
    const applicantQueries=()=>requests.filter(r=>r.pathname==='/api/hub/applications');
    assert.equal(applicantQueries().length,0,'The role picker needs no applicant list request');
    assert.ok(await role.evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));
    await role.click();
    await page.getByRole('link',{name:'Initial Engineer',exact:true}).waitFor();
    const initial=applicantQueries().at(-1).searchParams;
    assert.equal(initial.get('jobId'),'job-one');assert.equal(initial.get('stage'),'Application Review');
    assert.equal(await page.getByRole('link',{name:'Shortlisted Engineer',exact:true}).count(),0);
    const stage=page.getByLabel('Stage',{exact:true});await stage.selectOption('stage:Screening');
    await page.getByRole('link',{name:'Shortlisted Engineer',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Initial Engineer',exact:true}).count(),0);
    await stage.selectOption('all');
    const candidate=page.getByRole('link',{name:'Initial Engineer',exact:true});await candidate.waitFor();
    await page.getByRole('link',{name:'Shortlisted Engineer',exact:true}).waitFor();
    const queueUrl=new URL(page.url());await candidate.click();
    await page.getByRole('heading',{name:'Initial Engineer',exact:true}).waitFor();
    await page.getByRole('button',{name:'Back to applications',exact:true}).click();
    await candidate.waitFor();assert.equal(await stage.inputValue(),'all');assert.equal(new URL(page.url()).searchParams.get('jobId'),queueUrl.searchParams.get('jobId'));
    assert.ok(applicantQueries().every(r=>r.searchParams.has('jobId')),'No broad request when switching stages or returning from detail');
    await page.getByRole('link',{name:'Active roles',exact:true}).click();await roleDirectory.waitFor();
    const group=page.getByRole('link',{name:/Recruiter/});await group.click();
    await page.getByRole('link',{name:'Eastern Applicant',exact:true}).waitFor();await page.getByRole('link',{name:'Western Applicant',exact:true}).waitFor();
    const grouped=applicantQueries().at(-1).searchParams;
    assert.equal(grouped.get('jobGroupId'),'recruiting');assert.equal(grouped.get('openPostings'),'true');assert.equal(grouped.get('stage'),'Application Review');
    assert.equal(await page.getByRole('link',{name:'Closed Posting Applicant',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }
});
test('explicit all-applicant and existing global stage URLs open directly into their requested queues',async t=>{
  const {page,requests}=await setup(t,{dashboard:true,width:390});
  const all=page.getByRole('link',{name:'All applicants',exact:true});await all.click();
  await page.getByRole('link',{name:'Closed Posting Applicant',exact:true}).waitFor();
  assert.equal(requests.filter(r=>r.pathname==='/api/hub/applications').at(-1).searchParams.get('active'),'false');
  await page.goto(new URL('/?view=applications&stage=Screening',page.url()).href);
  await page.getByRole('link',{name:'Shortlisted Engineer',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Initial Engineer',exact:true}).count(),0);
  const filters=requests.filter(r=>r.pathname==='/api/hub/applications').at(-1).searchParams;
  assert.equal(filters.get('stage'),'Screening');assert.equal(filters.has('jobId'),false);
});
