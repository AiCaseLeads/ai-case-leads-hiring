import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const member={email:'sales@example.invalid',role:'admin'};
const overview={counts:{applications:7,active:6,rejected:1,hired:0},stageCounts:[{stage:'Application Review',count:4}],recentApplications:[{id:"app1"}],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:[{id:'job1',title:'Engineer',location:'Remote — Spain',status:'open'}]};
async function setup(t,role='admin',overdue=0,query=''){
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {HiringDashboard} from './components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify({...member,role})}} signOutHref="/logout"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'stub-job-wizard',setup(build){build.onResolve({filter:/^\.\/candidates$/},args=>args.importer.endsWith('/dashboard.tsx')?{path:'candidates',namespace:'candidate-stub'}:null);build.onLoad({filter:/.*/,namespace:'candidate-stub'},()=>({contents:`import React from 'react';export function Candidates({initialStage,initialJobId}){return <section><h2>Applicant list</h2><p>Filter stage: {initialStage||'All stages'}</p><p>Filter job: {initialJobId||'All jobs'}</p></section>};export function CandidateDetail({back}){return <section><h2>Applicant detail</h2><button onClick={back}>Back to applicants</button></section>};export function CandidateTable({select}){return <button onClick={()=>select("app1")}>Recent applicant</button>}`,loader:'tsx',resolveDir:process.cwd()}));build.onResolve({filter:/^\.\/jobs$/},args=>args.importer.endsWith('/dashboard.tsx')?{path:'jobs',namespace:'wizard-stub'}:null);build.onLoad({filter:/.*/,namespace:'wizard-stub'},()=>({contents:`import React from 'react';export function Jobs({startCreating,onManageScorecards}){return <section><h2>{startCreating?'Create a job step by step':'Job postings'}</h2><button onClick={onManageScorecards}>Manage scorecard templates</button></section>}`,loader:'tsx',resolveDir:process.cwd()}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const data=path==='/api/hub/overview'?overview:path==='/api/review-reminders'?{total:overdue,staff:[],config:{dueHours:48,enabled:false,fallbackAdmins:[]},applications:overdue?[{id:'app1',name:'Sample Applicant',jobTitle:'Engineer',assignee:null,stageEnteredAt:0}]:[]}:path==='/api/hub/tasks'?[]:path==='/api/hub/settings'?{settingsVersion:1,members:[member],google:{connected:true,sender:member.email,calendarId:member.email,driveRootId:'shared'},queue:{pending:0,failed:0},templates:{rejection:''},applicationsEnabled:true}:path==='/api/scorecards'?{revision:0,templates:[],archived:[],bindings:{}}:{};await route.fulfill({json:{data}});});
 await page.goto(`http://127.0.0.1:${server.address().port}${query}`);await page.getByRole('navigation',{name:'Hiring workspace'}).waitFor();if(!query)await page.getByRole('heading',{name:'What needs your attention?'}).waitFor();return page;
}
test('home prioritizes applicant work, keeps connection status compact and starts guided job creation',async t=>{
 const page=await setup(t);assert.deepEqual(await page.getByRole('navigation',{name:'Hiring workspace'}).getByRole('button').allTextContents(),['Home','Applications','Jobs','Reports','Settings']);
 await page.getByText('No overdue reviews',{exact:true}).waitFor();assert.equal(await page.getByLabel('Show overdue applications').count(),0);assert.equal(await page.getByRole('heading',{name:'Platform status'}).count(),0);
 assert.match(await page.getByRole('button',{name:/In application review/}).textContent(),/4/);
 await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('heading',{name:'Create a job step by step'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'jobs');await page.reload();await page.getByRole('heading',{name:'Job postings',exact:true}).waitFor();
 await page.getByRole('button',{name:'Manage scorecard templates',exact:true}).click();await page.getByRole('heading',{name:'Reusable scorecards',exact:true}).waitFor();assert.equal(await page.locator('#scorecard-settings').count(),1);assert.equal(await page.locator('#scorecard-settings').isVisible(),true);
});
test('recruiters can review overdue work and see delivery activity without administrator controls',async t=>{
 const page=await setup(t,'recruiter',1);await page.getByRole('button',{name:'Sample Applicant · Engineer',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create job',exact:true}).count(),1);assert.equal(await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).count(),1);
 await page.getByRole('button',{name:'Delivery activity',exact:true}).click();await page.getByRole('heading',{name:'Delivery activity',exact:true}).waitFor();
});

test('review shortcut and validated job links retain exact filters after a refresh, while ordinary navigation clears them',async t=>{
 const page=await setup(t);await page.getByRole('button',{name:/In application review/}).click();await page.getByText('Filter stage: Application Review',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('stage'),'Application Review');
 await page.reload();await page.getByText('Filter stage: Application Review',{exact:true}).waitFor();await page.getByRole('navigation').getByRole('button',{name:'Applications',exact:true}).click();await page.getByText('Filter stage: All stages',{exact:true}).waitFor();
 await page.goto(new URL('/?view=applications&jobId=job1',page.url()).href);await page.getByText('Filter job: job1',{exact:true}).waitFor();await page.getByRole('navigation').getByRole('button',{name:'Applications',exact:true}).click();await page.getByText('Filter job: All jobs',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('jobId'),false);
 await page.goto(new URL('/?view=applications&jobId=unknown',page.url()).href);await page.getByText('Filter job: All jobs',{exact:true}).waitFor();
});

 test('browser Back and Forward follow dashboard sections and candidate return paths',async t=>{
 const page=await setup(t);const nav=page.getByRole('navigation',{name:'Hiring workspace'});
 await nav.getByRole('button',{name:'Jobs',exact:true}).click();await page.getByRole('heading',{name:'Job postings'}).waitFor();
 await nav.getByRole('button',{name:'Applications',exact:true}).click();await page.getByRole('heading',{name:'Applicant list'}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Job postings'}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'What needs your attention?'}).waitFor();
 await page.getByRole('button',{name:'Recent applicant',exact:true}).click();await page.getByRole('heading',{name:'Applicant detail'}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'What needs your attention?'}).waitFor();
 await page.goForward();await page.getByRole('heading',{name:'Applicant detail'}).waitFor();
 await page.getByRole('button',{name:'Back to applicants'}).click();await page.getByRole('heading',{name:'What needs your attention?'}).waitFor();
 });
 test('a direct candidate link closes inside its queue instead of leaving the website',async t=>{
 const page=await setup(t,'admin',0,'/?view=applications&stage=Screening&application=app1');
 await page.getByRole('heading',{name:'Applicant detail'}).waitFor();await page.getByRole('button',{name:'Back to applicants'}).click();
 await page.getByText('Filter stage: Screening',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('application'),false);
 });
