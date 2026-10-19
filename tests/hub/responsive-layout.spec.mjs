import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {installDraftFixture} from './draft-ui-fixture.mjs';

const longEmail = 'creative.strategy.recruiting.team@long-company-example.invalid';
const member = { email: longEmail, role: 'admin', isOwner:true };
const job = { id: 'job-1', title: 'Synthetic Creative Strategist', slug: 'synthetic-creative', location: 'Remote · Spain and United States', status: 'open', fields: [], rules: [], formVersion: 1, archiveCountry: 'Spain', hiringRound: 'October' };
const detail = { id: 'app-1', revision: 1, name: 'Synthetic Applicant With A Long Name', email: longEmail, jobId: job.id, jobTitle: job.title, stage: 'Application Review', qualification: 'review', assignee: longEmail, createdAt: Date.now(), updatedAt: Date.now(), source: 'test', fields: [{path:'experience',title:'Experience',type:'LongText',required:false}], answers: [{path:'experience',value:'Synthetic work sample'}], files: [{id:'file-1',filename:'synthetic-resume-with-a-long-original-file-name.pdf',url:'/api/files/file-1',contentType:'application/pdf',size:500}], history: [], notes: [], communications: [], scorecards: [], qualificationEvidence: [],aiMatch:{status:'ready',score:88,updatedAt:Date.now()} };
const settings = {settingsVersion:1,members:[member,{email:'reviewer@example.invalid',role:'recruiter'}],google:{connected:true,sender:longEmail,expectedSender:longEmail,calendarId:longEmail,driveRootId:'shared'},queue:{pending:0,failed:0},templates:{rejection:'Thank you for applying.'},applicationsEnabled:true,accessAudit:[{id:'audit-1',type:'Company configuration updated',actor:longEmail,createdAt:Date.now(),before:{calendarId:longEmail},after:{calendarId:longEmail,driveRootId:'synthetic-shared-folder-'+ 'x'.repeat(80)}}],scheduling:{timeZone:'America/Bogota',startHour:10,endHour:16,durationMinutes:30,weekdays:[1,2,3,4,5],configured:true,remindersEnabled:false}};
async function setup(t,{role='admin',isOwner=true,browserZoom=1}={}) {
 const currentMember={...member,role,isOwner};
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify(currentMember)}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const globalCss=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css;
 const css=globalCss+'\n'+readFileSync('components/hub/hub.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/styles.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:req.url==='/styles.css'?css:'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';let profile=null;
 if(browserZoom!==1){profile=mkdtempSync(path.join(os.tmpdir(),'hiring-layout-zoom-'));mkdirSync(path.join(profile,'Default'));writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(browserZoom)/Math.log(1.2)}}}));}
 const launch={headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})};const browser=profile?await chromium.launchPersistentContext(profile,launch):await chromium.launch(launch);t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));if(profile)rmSync(profile,{recursive:true,force:true});});const page=await browser.newPage();page.setDefaultTimeout(5000);const writes=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;if(route.request().method()!=='GET')writes.push(path);let data={};
  if(path==='/api/hub/overview')data={counts:{applications:1,active:1,rejected:0,hired:0},stageCounts:[{stage:'Application Review',count:1}],recentApplications:[detail],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:[job]};
  if(path==='/api/hub/application-counts')data={items:[{jobId:job.id,total:1,needsReview:1,aiReady:0}]};
  if(path==='/api/hub/recruiting-help')data={items:[],hasMore:false};
  if(path==='/api/interview-readiness')data={sender:longEmail,mailReady:true,mailIssue:null,sharedCalendarReady:true,interviewers:[{email:longEmail,ready:true}]};
  if(path==='/api/ai/match')data=new URL(route.request().url()).searchParams.has('applicationId')?{status:'ready',score:88,criteria:[{criterion:'Project delivery',status:'evidence_found',explanation:'Built production projects with a distributed team.',citations:[{source:'resume:synthetic.pdf',quote:'Shipped production projects.'}]}]}:{enabled:true,version:1,status:'ready',available:true,criteria:['Project delivery']};
  if(path==='/api/hub/applications')data={items:[detail],total:1,page:1,pageSize:25};
  if(path==='/api/hub/applications/app-1')data=detail;
  if(path==='/api/scorecards')data={template:null,revision:0,templates:[],archived:[],bindings:{}};
  if(path==='/api/hub/jobs')data=[job];
  if(path==='/api/job-team')data={config:null,staff:[member,{email:'reviewer@example.invalid',role:'recruiter'}],sender:longEmail};
  if(path==='/api/job-setup')data={revision:0,templates:[],requests:[],locations:{}};
  if(path==='/api/ai/config')data={configured:false,enabled:false,reviewOnly:true};
  if(path==='/api/review-reminders')data={total:0,applications:[],staff:[member],config:{enabled:false,dueHours:48,fallbackAdmins:[]}};
  if(path==='/api/hub/settings')data=settings;
  if(path==='/api/team')data={members:[member],canManageTeam:true};
  if(path==='/api/personal-calendar')data={email:longEmail,connected:true,ready:true,configured:true,calendarId:null,availability:{timeZone:'America/Bogota',weekdays:[1,2,3,4,5],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14},interviewers:[]};
  if(path==='/api/personal-mail')data={email:longEmail,connected:true,configured:true,candidateConnected:true,canConnect:true};
  if(path==='/api/google/status')data={configured:true,hostingPlatform:'railway',backgroundEnabled:true,credentialsManaged:true,expectedSender:longEmail};
  if(path==='/api/hub/reports')data={applications:1,qualificationRate:0,attendance:{total:0,attended:0},conversion:[{stage:'Application Review',count:1}],stageCounts:[{stage:'Application Review',count:1}],sources:[{source:'LongUnbrokenCampaignSource'.repeat(12),count:1,qualified:0,interviewed:0,hired:0}],timeInStage:[{stage:'Application Review',averageHours:48}],workload:[{assignee:longEmail,count:1}]};
  return route.fulfill({json:{data}});
 });
 await installDraftFixture(page,{team:false});
 return {page,writes,origin:`http://127.0.0.1:${server.address().port}`};
}
async function noOverflow(page) {
 const out=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('.hub-main *')].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.width&&(r.right>innerWidth+1||r.left < -1)&&!e.closest('.hub-table-wrap');}).slice(0,8).map(e=>({className:e.className||e.tagName,rect:e.getBoundingClientRect().toJSON()}))}));
 assert.ok(out.scroll<=out.width+1,JSON.stringify(out));
 assert.deepEqual(out.offenders,[],`Visible content must fit even when an ancestor hides overflow: ${JSON.stringify(out)}`);
}
const artifacts=process.env.HUB_LAYOUT_ARTIFACTS;
if(artifacts)mkdirSync(artifacts,{recursive:true});
test('redesigned workspace stays usable across mobile, tablet and desktop widths',async t=>{
 const {page,origin,writes}=await setup(t);const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 for(const width of [320,390,768,1280,1728]) {
  await page.setViewportSize({width,height:844});
  await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Hiring team & emails',exact:true}).isVisible(),false,'Secondary job actions start collapsed');
  await page.getByText('Actions',{exact:true}).click();
  await page.getByRole('button',{name:'Hiring team & emails',exact:true}).waitFor();
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/jobs-actions-${width}.png`,fullPage:true});}
  await noOverflow(page);await page.locator('.hub-job-menu > summary').press('Escape');
  assert.equal(await page.getByRole('button',{name:'Hiring team & emails',exact:true}).isVisible(),false);
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/jobs-${width}.png`,fullPage:true});}
  if(width<=900){
   assert.ok((await page.locator('.hub-sidebar').boundingBox()).height<=100,'Collapsed mobile header is compact');
   await page.getByRole('button',{name:'Open workspace menu'}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');
   assert.equal(await page.getByRole('button',{name:'Open workspace menu'}).evaluate(e=>e===document.activeElement),true);
   await page.keyboard.press('Enter');await page.getByRole('navigation',{name:'Hiring workspace'}).getByRole('button',{name:'Applicants',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'Open workspace menu'}).getAttribute('aria-expanded'),'false');
  }
  await page.goto(origin+'/?view=applications');await page.getByRole('heading',{name:'Choose a job',exact:true}).waitFor();await noOverflow(page);
  await page.getByRole('button',{name:job.title,exact:true}).click();
  await page.getByRole('button',{name:detail.name,exact:true}).waitFor();await noOverflow(page);
  const downloadSummary=page.locator('.hub-application-downloads > summary');await downloadSummary.click();await page.getByLabel('Download scope',{exact:true}).waitFor();await noOverflow(page);
  const buttonBoxes=await page.locator('.hub-download-actions > .hub-button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
  assert.equal(buttonBoxes.length,1,'The ordinary download action is the PDF/originals ZIP');
  const scopeBox=await page.getByLabel('Download scope',{exact:true}).boundingBox();
  assert.ok(buttonBoxes[0].left>=scopeBox.x+scopeBox.width+8||buttonBoxes[0].top>=scopeBox.y+scopeBox.height+8,'Scope and ZIP targets stay separated');
  if(width<=640)assert.ok(buttonBoxes[0].top>=scopeBox.y+scopeBox.height+8,'Mobile download controls stack');
  await downloadSummary.click();
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/applications-${width}.png`,fullPage:true});}
  const headerControls=page.locator('.hub-applications-table thead').locator('button,input,select,a[href]');if(width<=960)assert.equal(await headerControls.count(),0,'Card layout removes clipped keyboard controls');else assert.equal(await page.locator('.hub-applications-table thead .hub-table-sort').count(),4,'Desktop keeps all four sortable headers');
  if(width<=960){assert.equal(await page.locator('.hub-applications-table').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.getByLabel('Select '+detail.name,{exact:true}).check();assert.equal(await page.getByLabel('Select '+detail.name,{exact:true}).isChecked(),true);}
  await page.getByRole('button',{name:detail.name,exact:true}).click();await page.getByRole('heading',{name:detail.name,exact:true}).waitFor();await noOverflow(page);
  const actionsGap=await page.locator('[role="tablist"]').evaluate(tabs=>tabs.getBoundingClientRect().top-document.querySelector('.hub-candidate-quick-actions').getBoundingClientRect().bottom);assert.ok(actionsGap>=16,`Applicant quick actions must be separated from record tabs: ${actionsGap}px`);
  for(const tab of ['AI review & notes','Activity & messages','Application & files']){
   await page.getByRole('tab',{name:tab,exact:true}).click();await noOverflow(page);
   assert.equal(await page.locator('[role="tabpanel"][hidden]').evaluateAll(es=>es.every(e=>getComputedStyle(e).display==='none'&&e.getClientRects().length===0)),true,'Inactive record panels occupy no space');
   assert.ok(await page.locator('[role="tablist"]').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=-1&&r.top<innerHeight;}),'Changing a tab leaves record navigation in view');
  }
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/candidate-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'Request interview',exact:true}).click();await page.getByLabel('Who will conduct this interview?',{exact:true}).waitFor();await noOverflow(page);
  const interviewLayout=await page.locator('.hub-action-panel').evaluate(panel=>({panel:panel.getBoundingClientRect().toJSON(),record:document.querySelector('.hub-detail-main').getBoundingClientRect().toJSON()}));if(width<=1100)assert.ok(interviewLayout.panel.top<=interviewLayout.record.top,'Mobile interview setup appears before long applicant content');
  assert.equal(await page.getByRole('button',{name:'Send booking link',exact:true}).isDisabled(),true,'Opening an interview does not send or bypass interviewer choice');await page.locator('.hub-candidate-actions > summary').click();
  await page.goto(origin+'/?view=reports');await page.getByRole('heading',{name:'Reports',exact:true}).waitFor();
  for(const name of ['Overview','Sources','Team']){await page.getByRole('navigation',{name:'Report sections'}).getByRole('button',{name,exact:true}).click();await noOverflow(page);}
  await page.goto(origin+'/?view=home');await page.getByRole('heading',{name:'Hiring overview',exact:true}).waitFor();await noOverflow(page);
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/overview-${width}.png`,fullPage:true});}
  await page.goto(origin+'/?view=settings');await page.getByRole('heading',{name:'My interview calendar',exact:true}).waitFor();await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByLabel('Teammate’s Google Workspace email',{exact:true}).waitFor();await noOverflow(page);
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/settings-${width}.png`,fullPage:true});}
  if(width<=640)assert.equal(await page.getByLabel('Teammate’s Google Workspace email',{exact:true}).evaluate(e=>getComputedStyle(e).fontSize),'16px');
 }
 assert.deepEqual(pageErrors,[]);assert.ok(writes.every(path=>path.endsWith('/viewed')),'Browsing may mark viewed but must not send invitations or change stages');
});

async function questions(page,origin) {
 await page.goto(origin+'/?view=jobs');await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Synthetic mobile badge test');await page.getByLabel('Work arrangement',{exact:true}).selectOption('remote');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'What should applicants send?',exact:true}).waitFor();
}
test('question editor controls remain reachable on phones and tablet',async t=>{
 const {page,origin}=await setup(t);
 for(const width of [320,390,768]) {
  await page.setViewportSize({width,height:844});await questions(page,origin);
  await page.getByLabel('Add a question',{exact:true}).selectOption('custom');await page.getByRole('button',{name:'Add question',exact:true}).click();
  const label=page.getByLabel(/^Question \d+ label$/).filter({visible:true});await label.fill('Relevant experience');await noOverflow(page);
  assert.equal(await label.evaluate(e=>getComputedStyle(e).fontSize),'16px');
  assert.equal(await page.getByLabel(/^Question \d+ instructions \(optional\)$/).filter({visible:true}).count(),0,'Optional instructions stay collapsed');
  const format=page.getByLabel(/^Question \d+ answer format$/).filter({visible:true});await format.selectOption('Number');await noOverflow(page);
  const add=page.getByRole('button',{name:'Add question',exact:true});await add.scrollIntoViewIfNeeded();assert.equal(await add.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
  await page.setViewportSize({width,height:440});await label.focus();await page.keyboard.type(' mobile');assert.match(await label.inputValue(),/mobile/);await noOverflow(page);
  if(artifacts){await page.screenshot({path:`${artifacts}/question-editor-${width}.png`,fullPage:true});}
 }
});

test('Settings sections and company groups retain reachable save actions and expanded details',async t=>{
 const {page,origin,writes}=await setup(t);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const viewport of [{width:320,height:844},{width:390,height:844},{width:768,height:844},{width:1280,height:844},{width:1728,height:1080},{width:390,height:440},{width:1280,height:440}]){
  await page.setViewportSize(viewport);await page.goto(origin+'/?view=settings');await page.getByRole('heading',{name:'My interview calendar',exact:true}).waitFor();
  for(const section of ['My connections','Team','Templates','Help requests','Company']) {
   await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:section,exact:true}).click();await noOverflow(page);
   if(section==='Templates'){
    await page.getByRole('button',{name:'New scorecard template',exact:true}).click();await page.getByRole('button',{name:'Save template version',exact:true}).waitFor();await noOverflow(page);
    const boxes=await page.getByRole('button',{name:'Save template version',exact:true}).evaluate(e=>[...e.parentElement.querySelectorAll('button')].map(e=>e.getBoundingClientRect().toJSON()));assert.equal(boxes.length,3);
    for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].left-boxes[i-1].right>=8||boxes[i].top-boxes[i-1].bottom>=8,'Template edit actions have separate click targets');
   }
   if(section==='Company'){
    await page.getByRole('button',{name:'Save company settings',exact:true}).waitFor();
    for(const area of ['Files & calendar','Messages & reminders','AI','Advanced']){
     await page.getByRole('navigation',{name:'Company settings sections'}).getByRole('button',{name:area,exact:true}).click();await noOverflow(page);
     for(const summary of await page.locator('.hub-company-settings details > summary').all()){await summary.click();await noOverflow(page);}
     const save=page.getByRole('button',{name:'Save company settings',exact:true});if(await save.isVisible()){
      await save.scrollIntoViewIfNeeded();assert.equal(await save.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,'Save remains visible and uncovered');
      assert.equal(await save.evaluate(e=>getComputedStyle(e.parentElement).position),'static','Save controls stay in document flow');
     }
    }
   }
  }
  if(artifacts){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${artifacts}/company-expanded-${viewport.width}x${viewport.height}.png`,fullPage:true});}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'Settings viewing does not save changes or initiate connections');
});

test('role-specific settings preserve recruiter and head recruiter boundaries',async t=>{
 for(const role of ['recruiter','admin']) {
  const {page,origin}=await setup(t,{role,isOwner:false});await page.goto(origin+'/?view=settings');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  const nav=page.getByRole('navigation',{name:'Settings sections'});
  assert.equal(await nav.getByRole('button',{name:'Company',exact:true}).count(),0);
  assert.equal(await nav.getByRole('button',{name:'Team',exact:true}).count(),role==='admin'?1:0);
  await nav.getByRole('button',{name:'My connections',exact:true}).click();await page.getByRole('heading',{name:'My interview calendar',exact:true}).waitFor();await noOverflow(page);
  await page.goto(origin+'/?view=jobs');await page.getByRole('button',{name:'Create job',exact:true}).waitFor();
 }
});

test('workspace contains wide tables without clipping nested scrolling or keyboard-accessible menus',async t=>{
 const{page,origin,writes}=await setup(t);
 // 767/984 are the effective CSS widths reported by 130% browser zoom in the
 // live panel; 498 also covers a997px panel at200% browser zoom. Root CSS zoom
 // does not change media queries and is not a browser-zoom substitute.
 for(const width of [498,767,901,940,960,984,997,1280])for(const zoom of [1]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/?view=applications&jobId=job-1');await page.getByRole('button',{name:detail.name,exact:true}).waitFor();await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
  const dimensions=await page.evaluate(()=>({inner:innerWidth,htmlClient:document.documentElement.clientWidth,htmlScroll:document.documentElement.scrollWidth,bodyClient:document.body.clientWidth,bodyScroll:document.body.scrollWidth}));
  assert.ok(dimensions.htmlScroll<=dimensions.htmlClient+1,`Nested table overflow stays out of the document at${width}px zoom${zoom}: ${JSON.stringify(dimensions)}`);
  const horizontal=await page.evaluate(()=>{window.scrollTo({left:10000,top:0,behavior:'instant'});return window.scrollX;});assert.equal(horizontal,0,`Wide table contents cannot scroll the entire page horizontally at ${width}px CSS zoom ${zoom}: ${JSON.stringify(dimensions)}`);
  await noOverflow(page);
  const metadata=page.locator('.hub-applications-table tbody .hub-optional-owner');assert.equal(await metadata.isVisible(),width<=680||width>1100,'Owner metadata stays in mobile cards and desktop rows while tablet prioritizes actions');
  const stageLines=await page.locator('.hub-applications-table td[data-label="Stage"] .hub-badge').evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);return range.getClientRects().length;});assert.equal(stageLines,1,'The New stage remains a readable word');
  const wrap=page.locator('.hub-table-wrap').filter({has:page.locator('.hub-applications-table')});
  const scrolling=await wrap.evaluate(e=>{e.scrollLeft=e.scrollWidth;return{position:e.scrollLeft,max:e.scrollWidth-e.clientWidth};});
  if(width>680&&scrolling.max>0)assert.ok(scrolling.position>=scrolling.max-1,'Contained table can still scroll to its final column');
  const interview=page.getByRole('button',{name:'Request interview with '+detail.name,exact:true});await interview.focus();
  assert.equal(await interview.evaluate(e=>e===document.activeElement),true);
  await interview.scrollIntoViewIfNeeded();assert.equal(await interview.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,'Final-column interview action stays reachable after keyboard focus');
  await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
  await page.locator('.hub-job-menu > summary').focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Hiring team & emails',exact:true}).waitFor();
  await noOverflow(page);const team=page.getByRole('button',{name:'Hiring team & emails',exact:true});await team.focus();await team.scrollIntoViewIfNeeded();assert.equal(await team.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,'Expanded job menu action stays reachable');
  await page.locator('.hub-job-menu > summary').press('Escape');assert.equal(await team.isVisible(),false);
 }
 assert.deepEqual(writes,[],'Zooming, scrolling, focusing and opening menus never sends applicant messages');
});


test('real browser zoom at 130% and 200% preserves applicant actions and document containment',async t=>{
 for(const browserZoom of [1.3,2]){
  const{page,origin,writes}=await setup(t,{browserZoom});const cdp=await page.context().newCDPSession(page);
  for(const physicalWidth of [997,1280]){
   await page.setViewportSize({width:physicalWidth,height:900});await page.goto(origin+'/?view=applications&jobId=job-1');await page.getByRole('button',{name:detail.name,exact:true}).waitFor();
   const metrics=await cdp.send('Page.getLayoutMetrics');assert.ok(Math.abs(metrics.cssVisualViewport.zoom-browserZoom)<.01,'The fixture uses actual Chrome browser zoom');
   const width=metrics.cssLayoutViewport.clientWidth;
   assert.ok(metrics.cssContentSize.width<=width+1,`Browser page content stays contained at${browserZoom}× zoom: ${JSON.stringify(metrics)}`);
   await noOverflow(page);
   assert.equal(await page.evaluate(()=>{window.scrollTo({left:10000,top:0,behavior:'instant'});return window.scrollX;}),0);
   const owner=page.locator('.hub-applications-table tbody .hub-optional-owner');assert.equal(await owner.isVisible(),width<=680||width>1100,'Enlarged tablet view prioritizes next-step actions while mobile cards retain metadata');
   const wrap=page.locator('.hub-table-wrap').filter({has:page.locator('.hub-applications-table')});await wrap.evaluate(e=>e.scrollLeft=e.scrollWidth);
   const interview=page.getByRole('button',{name:'Request interview with '+detail.name,exact:true});await interview.focus();await interview.scrollIntoViewIfNeeded();assert.equal(await interview.evaluate(e=>{const r=e.getBoundingClientRect();return e===document.activeElement&&e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,'Interview controls remain focusable and reachable at actual browser zoom');
   await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();await page.locator('.hub-job-menu > summary').focus();await page.keyboard.press('Enter');const team=page.getByRole('button',{name:'Hiring team & emails',exact:true});await team.waitFor();await noOverflow(page);await team.focus();await team.scrollIntoViewIfNeeded();assert.equal(await team.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,'Job action menus remain usable at actual browser zoom');
  }
  assert.deepEqual(writes,[]);
 }
});
