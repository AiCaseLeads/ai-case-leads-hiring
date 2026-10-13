import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const longEmail = 'creative.strategy.recruiting.team@long-company-example.invalid';
const member = { email: longEmail, role: 'admin' };
const job = { id: 'job-1', title: 'Synthetic Creative Strategist', slug: 'synthetic-creative', location: 'Remote · Spain and United States', status: 'open', fields: [], rules: [], formVersion: 1, archiveCountry: 'Spain', hiringRound: 'October' };
const detail = { id: 'app-1', revision: 1, name: 'Synthetic Applicant With A Long Name', email: longEmail, jobId: job.id, jobTitle: job.title, stage: 'Application Review', qualification: 'review', assignee: longEmail, createdAt: Date.now(), updatedAt: Date.now(), source: 'test', fields: [{path:'experience',title:'Experience',type:'LongText',required:false}], answers: [{path:'experience',value:'Synthetic work sample'}], files: [{id:'file-1',filename:'synthetic-resume-with-a-long-original-file-name.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}], history: [], notes: [], communications: [], scorecards: [], qualificationEvidence: [] };
const settings = {settingsVersion:1,members:[member,{email:'reviewer@example.invalid',role:'recruiter'}],google:{connected:true,sender:longEmail,expectedSender:longEmail,calendarId:longEmail,driveRootId:'shared'},queue:{pending:0,failed:0},templates:{rejection:'Thank you for applying.'},applicationsEnabled:true,scheduling:{timeZone:'America/Bogota',startHour:10,endHour:16,durationMinutes:30,weekdays:[1,2,3,4,5],configured:true,remindersEnabled:false}};
async function setup(t) {
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify(member)}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const globalCss=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css;
 const css=globalCss+'\n'+readFileSync('components/hub/hub.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/styles.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:req.url==='/styles.css'?css:'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});const page=await browser.newPage();
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;let data={};
  if(path==='/api/hub/overview')data={counts:{applications:1,active:1,rejected:0,hired:0},stageCounts:[],recentApplications:[detail],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:[job]};
  if(path==='/api/hub/applications')data={items:[detail],total:1,page:1,pageSize:25};
  if(path==='/api/hub/applications/app-1')data=detail;
  if(path==='/api/scorecards')data={template:null,revision:0,templates:[],archived:[],bindings:{}};
  if(path==='/api/hub/jobs')data=[job];
  if(path==='/api/job-team')data={config:null,staff:[member,{email:'reviewer@example.invalid',role:'recruiter'}],sender:longEmail};
  if(path==='/api/job-setup')data={revision:0,templates:[],requests:[],locations:{}};
  if(path==='/api/ai/config')data={configured:false,enabled:false,reviewOnly:true};
  if(path==='/api/review-reminders')data={total:0,applications:[],staff:[member],config:{enabled:false,dueHours:48,fallbackAdmins:[]}};
  if(path==='/api/hub/settings')data=settings;
  if(path==='/api/google/status')data={configured:true,hostingPlatform:'railway',backgroundEnabled:true,credentialsManaged:true,expectedSender:longEmail};
  if(path==='/api/hub/reports')data={applications:1,qualificationRate:0,attendance:{total:0,attended:0},conversion:[],stageCounts:[],sources:[],timeInStage:[],workload:[]};
  return route.fulfill({json:{data}});
 });
 return {page,origin:`http://127.0.0.1:${server.address().port}`};
}
async function noOverflow(page) {
 const out=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('.hub-main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&!e.closest('.hub-table-wrap');}).slice(0,8).map(e=>e.className||e.tagName)}));
 assert.ok(out.scroll<=out.width+1,JSON.stringify(out));
}
const artifacts=process.env.HUB_LAYOUT_ARTIFACTS;
if(artifacts)mkdirSync(artifacts,{recursive:true});
test('real styled hub stays usable across mobile, tablet and desktop widths',async t=>{
 const {page,origin}=await setup(t);const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 for(const width of [320,375,390,768,1280]) {
  await page.setViewportSize({width,height:844});
  await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
  if(artifacts)await page.screenshot({path:`${artifacts}/jobs-${width}.png`,fullPage:true});
  if(!process.env.HUB_LAYOUT_CAPTURE_ONLY){await noOverflow(page);if(width<=960){assert.ok((await page.locator('.hub-sidebar').boundingBox()).height<=100,'Collapsed mobile header is compact');await page.getByRole('button',{name:'Open workspace menu'}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Open workspace menu'}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');await page.getByRole('navigation',{name:'Hiring workspace'}).getByRole('button',{name:'Applications',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Open workspace menu'}).getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('button',{name:'Open workspace menu'}).evaluate(e=>e===document.activeElement),true);}}
  await page.goto(origin+'/?view=applications');await page.getByRole('button',{name:detail.name,exact:true}).waitFor();
  if(artifacts)await page.screenshot({path:`${artifacts}/applications-${width}.png`,fullPage:true});
  if(!process.env.HUB_LAYOUT_CAPTURE_ONLY){await noOverflow(page);if(width<=680){assert.equal(await page.locator('.hub-applications-table').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.getByLabel('Select '+detail.name,{exact:true}).check();assert.equal(await page.getByLabel('Select '+detail.name,{exact:true}).isChecked(),true);}}
  await page.getByRole('button',{name:detail.name,exact:true}).click();await page.getByRole('heading',{name:detail.name,exact:true}).waitFor();
  if(artifacts)await page.screenshot({path:`${artifacts}/candidate-${width}.png`,fullPage:true});
  if(!process.env.HUB_LAYOUT_CAPTURE_ONLY){await noOverflow(page);const gap=await page.evaluate(()=>document.querySelector('[role="tabpanel"]:not([hidden])').getBoundingClientRect().top-document.querySelector('[role="tablist"]').getBoundingClientRect().bottom);assert.ok(gap>=16,'Tabs have breathing room before content');}
  await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Synthetic mobile job');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
  if(artifacts)await page.screenshot({path:`${artifacts}/job-questions-${width}.png`,fullPage:true});
  if(!process.env.HUB_LAYOUT_CAPTURE_ONLY){await noOverflow(page);const library=await page.getByRole('button',{name:'Add selected question',exact:true}).boundingBox(),custom=await page.getByRole('button',{name:'Add custom question',exact:true}).boundingBox();assert.ok(custom.y-library.y-library.height>=12,'Library and custom question actions have separation');const rows=await page.locator('.hub-question').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));for(let i=1;i<rows.length;i++)assert.ok(rows[i].top-rows[i-1].bottom>=16,'Question cards have separation');}
  await page.goto(origin+'/?view=reports');await page.getByRole('heading',{name:'Reports',exact:true}).waitFor();if(!process.env.HUB_LAYOUT_CAPTURE_ONLY)await noOverflow(page);
  await page.goto(origin+'/?view=home');await page.getByRole('heading',{name:'What needs your attention?',exact:true}).waitFor();if(!process.env.HUB_LAYOUT_CAPTURE_ONLY)await noOverflow(page);
  await page.goto(origin+'/?view=settings');await page.getByRole('heading',{name:'1. Connect your recruiting Google account',exact:true}).waitFor();await page.getByText('Team access',{exact:true}).click();
  if(artifacts)await page.screenshot({path:`${artifacts}/settings-${width}.png`,fullPage:true});
  if(!process.env.HUB_LAYOUT_CAPTURE_ONLY){await noOverflow(page);const buttons=await page.locator('.hub-button:visible,.hub-icon-button:visible').evaluateAll(es=>es.map(e=>({label:e.textContent,height:e.getBoundingClientRect().height})));assert.ok(buttons.every(e=>e.height>=44),JSON.stringify(buttons.filter(e=>e.height<44)));if(width<=640)assert.equal(await page.getByLabel('Teammate 1 email',{exact:true}).evaluate(e=>getComputedStyle(e).fontSize),'16px');}
 }
 assert.deepEqual(pageErrors,[]);
});

test('question badges and final controls stay readable above the mobile save bar',async t=>{
 const {page,origin}=await setup(t);
 for(const width of [320,375]) {
  await page.setViewportSize({width,height:844});await page.goto(origin+'/?view=jobs');
  await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Synthetic mobile badge test');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
  const headings=await page.locator('.hub-question-heading').evaluateAll(es=>es.map(e=>{const badge=e.querySelector('.hub-badge'),title=e.querySelector('strong'),button=e.querySelector('button');const range=document.createRange();range.selectNodeContents(badge);return{lines:range.getClientRects().length,badge:badge.getBoundingClientRect().toJSON(),title:title.getBoundingClientRect().toJSON(),button:button?.getBoundingClientRect().toJSON()};}));
  for(const row of headings){assert.equal(row.lines,1,'Required/Optional stays on a single line');assert.ok(row.badge.y>=row.title.bottom,'Title has its own row');if(row.button)assert.ok(row.button.x>=row.badge.right+8,'Remove button does not pinch the badge');}
  assert.equal(await page.locator('.hub-sticky-save').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
  const library=page.getByLabel('Add from the question library',{exact:true});await library.focus();await page.keyboard.press('Tab');const custom=page.getByRole('button',{name:'Add custom question',exact:true});assert.equal(await custom.evaluate(e=>e===document.activeElement),true);
  await custom.scrollIntoViewIfNeeded();assert.equal(await custom.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Final custom-question control is not covered');
  if(artifacts)await page.screenshot({path:`${artifacts}/question-badges-${width}.png`,fullPage:true});
  await page.setViewportSize({width,height:440});await page.getByLabel('Question 4 label',{exact:true}).focus();await page.keyboard.type(' mobile');assert.match(await page.getByLabel('Question 4 label',{exact:true}).inputValue(),/mobile/);assert.equal(await page.locator('.hub-sticky-save').evaluate(e=>getComputedStyle(e).position),'static','Short viewports leave the form unobstructed');await noOverflow(page);
 }
});
