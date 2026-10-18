import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {build} from 'esbuild';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {installDraftFixture} from './draft-ui-fixture.mjs';

const member={email:'head@example.invalid',role:'admin',isOwner:true};
const jobs=Array.from({length:8},(_,i)=>({id:'job-'+i,title:'Synthetic job '+i,slug:'synthetic-'+i,status:'open',location:'Remote · Worldwide',fields:[],rules:[],formVersion:1,descriptionHtml:'<p>Job description</p>'}));
const applicant={id:'app-1',name:'Synthetic applicant',email:'applicant@example.invalid',jobId:jobs[0].id,jobTitle:jobs[0].title,stage:'Application Review',qualification:'pass',revision:1,createdAt:1,aiMatch:{status:'ready',score:90}};
let compiled;
async function setup(t,{width=1280,height=900,browserZoom=1}={}){
 compiled??=Promise.all([
  build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {HiringDashboard} from './components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify(member)}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'}),
  postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})
 ]).then(([bundle,global])=>({js:bundle.outputFiles[0].text,css:global.css+'\n'+readFileSync('components/hub/hub.css','utf8')}));
 const assets=await compiled;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/styles.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?assets.js:req.url==='/styles.css'?assets.css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root" data-hiring-workspace></div><script src="/bundle.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const launch={headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})};
 let profile;
 if(browserZoom!==1){profile=mkdtempSync(path.join(os.tmpdir(),'hub-dialog-zoom-'));mkdirSync(path.join(profile,'Default'));writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(browserZoom)/Math.log(1.2)}}}));}
 const browser=profile?await chromium.launchPersistentContext(profile,launch):await chromium.launch(launch);
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));if(profile)rmSync(profile,{recursive:true,force:true});});
 const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
 const writes=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());let data={};
  if(route.request().method()!=='GET')writes.push(url.pathname);
  if(url.pathname==='/api/hub/overview')data={counts:{applications:8,active:8,rejected:0,hired:0},stageCounts:[],recentApplications:[],integrations:{google:true,drive:true,applicationsEnabled:true},jobs};
  if(url.pathname==='/api/review-reminders')data={total:0,applications:[],staff:[member],config:{enabled:false,dueHours:48,fallbackAdmins:[]}};
  if(url.pathname==='/api/hub/jobs')data=jobs;
  if(url.pathname==='/api/hub/application-counts')data={items:jobs.map(job=>({jobId:job.id,total:1,needsReview:0,aiReady:1}))};
  if(url.pathname==='/api/hub/applications')data={items:[applicant],total:1,page:1,pageSize:25};
  if(url.pathname==='/api/ai/match')data={enabled:false,available:true,status:'disabled',version:1,criteria:[]};
  if(url.pathname==='/api/scorecards')data={revision:0,templates:[],archived:[],bindings:{}};
  if(url.pathname==='/api/job-setup')data={revision:0,templates:[],requests:[],locations:{}};
  if(url.pathname==='/api/job-team')data={config:null,staff:[member],sender:member.email};
  if(url.pathname==='/api/hub/applications-export')return route.fulfill(url.searchParams.has('check')?{json:{data:{count:1}}}:{contentType:'application/zip',headers:{'Content-Disposition':'attachment; filename="synthetic.zip"'},body:'PK synthetic'});
  return route.fulfill({json:{data}});
 });
 await installDraftFixture(page,{team:false});
 return {page,writes,errors,origin:'http://127.0.0.1:'+server.address().port};
}
async function noOverflow(page){
 const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('.hub-main button,.hub-main input,.hub-main select,.hub-main summary')].filter(e=>e.checkVisibility()&&!e.closest('.hub-table-wrap')).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1;}).map(e=>e.outerHTML.slice(0,100))}));
 assert.ok(metrics.scroll<=metrics.width+1,JSON.stringify(metrics));assert.deepEqual(metrics.offenders,[]);
}
async function artifact(page,name){if(process.env.HUB_LAYOUT_ARTIFACTS){mkdirSync(process.env.HUB_LAYOUT_ARTIFACTS,{recursive:true});await page.screenshot({path:process.env.HUB_LAYOUT_ARTIFACTS+'/'+name+'.png',fullPage:!/(draft-exit|bounded-job-actions|dialog-actual-zoom)/.test(name)});}}

test('draft exit actions and focus rings have separate targets across narrow and enlarged layouts',async t=>{
 const {page,origin,errors}=await setup(t);
 for(const width of [320,390,640,1280]){
  await page.setViewportSize({width,height:720});await page.goto(origin+'/?view=jobs');
  await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();
  await page.getByLabel('Job title',{exact:true}).fill('Synthetic changed draft');
  await page.getByRole('button',{name:'Back to jobs',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await noOverflow(page);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflowY),'hidden','Modal background cannot scroll');
  const layout=await dialog.evaluate(d=>({box:d.getBoundingClientRect().toJSON(),actions:[...d.querySelectorAll('button')].map(e=>({box:e.getBoundingClientRect().toJSON(),outline:e===document.activeElement?parseFloat(getComputedStyle(e).outlineWidth)+parseFloat(getComputedStyle(e).outlineOffset):0,overflow:e.scrollWidth>e.clientWidth+1}))}));
  for(let i=1;i<layout.actions.length;i++){
   const previous=layout.actions[i-1],current=layout.actions[i];
   const separation=Math.max(current.box.left-previous.box.right,current.box.top-previous.box.bottom);
   assert.ok(separation>=12,JSON.stringify(layout));
   assert.ok(separation>previous.outline,'Focused action must not overlap another target');
  }
  assert.equal(layout.actions.some(a=>a.overflow),false);assert.ok(layout.box.left>=0&&layout.box.right<=width);
  await artifact(page,'draft-exit-'+width);
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await page.getByRole('button',{name:'Back to jobs',exact:true}).click();
  await page.getByRole('button',{name:'Leave without saving',exact:true}).click();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
  assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).overflowY),'hidden','Closing the modal restores normal scrolling');
 }
 assert.deepEqual(errors,[]);
});

test('last-job ZIP download does not extend the page into a blank overflow area or leave an open flyout',async t=>{
 const {page,origin,writes,errors}=await setup(t);
 for(const width of [320,390,768,1280,1728]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/?view=applications');await page.getByRole('heading',{name:'Choose a job',exact:true}).waitFor();
  const row=page.locator('.hub-application-job-row').last();await row.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>document.documentElement.scrollHeight);
  const legacySummary=row.locator('.hub-job-download-menu > summary');
  if(await legacySummary.count())await legacySummary.click();
  const after=await page.evaluate(()=>document.documentElement.scrollHeight);
  assert.ok(after<=before+1,`Opening bottom-job download adds ${after-before}px outside the layout at ${width}px`);
  await row.getByRole('button',{name:'Download all applications ZIP for Synthetic job 7',exact:true}).click();
  await page.getByText(/Synthetic job 7: download started/).waitFor();
  assert.equal(await page.locator('.hub-job-download-menu[open]').count(),0,'Downloads must not leave a flyout open');
  await noOverflow(page);await artifact(page,'last-job-download-'+width);
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});

test('screening, reviewer grade and owner filter controls align even with helper text',async t=>{
 const {page,origin}=await setup(t);
 for(const width of [320,390,768,1280,1728]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/?view=applications&jobId=job-0');
  await page.locator('.hub-advanced-filters > summary').click();
  const fields=await page.locator('.hub-advanced-filters .hub-filter-grid .hub-field').evaluateAll(es=>es.map(e=>({box:e.getBoundingClientRect().toJSON(),label:e.querySelector('label').getBoundingClientRect().toJSON(),control:e.querySelector('input,select').getBoundingClientRect().toJSON()})));
  if(width>=1280){assert.ok(Math.max(...fields.map(f=>f.label.top))-Math.min(...fields.map(f=>f.label.top))<=1,JSON.stringify(fields));assert.ok(Math.max(...fields.map(f=>f.control.top))-Math.min(...fields.map(f=>f.control.top))<=1,JSON.stringify(fields));}
  for(let i=1;i<fields.length;i++)if(fields[i].box.top>=fields[i-1].box.bottom)assert.ok(fields[i].box.top-fields[i-1].box.bottom>=12,'Wrapped filters retain spacing');
  await noOverflow(page);await artifact(page,'aligned-filters-'+width);
 }
});


test('final job Actions menu stays inside the viewport, closes on outside click and Escape, and does not enlarge the document',async t=>{
 const {page,origin,writes,errors}=await setup(t);
 for(const viewport of [{width:320,height:720},{width:390,height:440},{width:768,height:720},{width:1280,height:900},{width:1728,height:900}]){
  await page.setViewportSize(viewport);await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
  const row=page.locator('.hub-job-row').last(),summary=row.locator('.hub-job-menu > summary');await summary.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>document.documentElement.scrollHeight);
  await summary.focus();await page.keyboard.press('Enter');const menu=row.locator('.hub-job-menu-items');await menu.waitFor();
  const metrics=await menu.evaluate(e=>({box:e.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,position:getComputedStyle(e).position,scroll:e.scrollHeight,client:e.clientHeight}));
  assert.equal(metrics.position,'fixed');assert.ok(metrics.box.left>=15&&metrics.box.right<=metrics.width-15,JSON.stringify(metrics));assert.ok(metrics.box.top>=15&&metrics.box.bottom<=metrics.height-13,JSON.stringify(metrics));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),before,'Bottom-row actions do not create blank document overflow');
  // Every action is still reachable when the short viewport requires menu scrolling.
  const last=menu.getByRole('link',{name:'View public job',exact:true});await last.scrollIntoViewIfNeeded();
  assert.equal(await last.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
  await artifact(page,'bounded-job-actions-'+viewport.width+'x'+viewport.height);
  await summary.press('Escape');assert.equal(await menu.isVisible(),false);assert.equal(await summary.evaluate(e=>document.activeElement===e),true);
  await summary.click();await menu.waitFor();await page.locator('.hub-main h2').click();assert.equal(await menu.isVisible(),false);
  await summary.scrollIntoViewIfNeeded();await summary.click();await menu.waitFor();await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForFunction(()=>!document.querySelector('.hub-job-row:last-child details').open);assert.equal(await menu.isVisible(),false,'A menu closes if its row scrolls outside the viewport');
  await noOverflow(page);
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});

test('unchanged job editing can leave without a draft warning',async t=>{
 const {page,origin,writes}=await setup(t);await page.goto(origin+'/?view=jobs');await page.locator('.hub-job-row').first().getByRole('button',{name:'Edit job',exact:true}).click();
 await page.getByLabel('Job title',{exact:true}).waitFor();await page.getByRole('button',{name:'Save progress now',exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to jobs',exact:true}).click();await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(writes,[]);
});

test('actual 130% and 200% browser zoom keeps draft dialog targets separated and menus bounded',async t=>{
 for(const browserZoom of [1.3,2]){
  const {page,origin}=await setup(t,{width:1280,height:900,browserZoom});const cdp=await page.context().newCDPSession(page);
  await page.goto(origin+'/?view=jobs');await page.getByRole('heading',{name:'Jobs',exact:true}).waitFor();
  const summary=page.locator('.hub-job-row').last().locator('.hub-job-menu > summary');await summary.scrollIntoViewIfNeeded();await summary.click();
  const menu=page.locator('.hub-job-row').last().locator('.hub-job-menu-items');await menu.waitFor();
  const metrics=await cdp.send('Page.getLayoutMetrics');assert.ok(Math.abs(metrics.cssVisualViewport.zoom-browserZoom)<.01,'Use real browser zoom, not CSS transform/zoom');
  const box=await menu.boundingBox();const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box.x>=15&&box.x+box.width<=viewport.width-15&&box.y>=15&&box.y+box.height<=viewport.height-13);
  await summary.press('Escape');await page.getByRole('button',{name:'Create job',exact:true}).click();await page.getByRole('button',{name:'Create blank job',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('Zoom draft');await page.getByRole('button',{name:'Back to jobs',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await noOverflow(page);
  const boxes=await dialog.locator('button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
  for(let i=1;i<boxes.length;i++)assert.ok(Math.max(boxes[i].left-boxes[i-1].right,boxes[i].top-boxes[i-1].bottom)>=12);
  await artifact(page,'dialog-actual-zoom-'+browserZoom);
 }
});


test('mixed job rows keep applicant, edit and Actions controls aligned with open newest jobs first',async t=>{
 const {page,origin,errors}=await setup(t);
 const mixed=jobs.map((job,i)=>({...job,status:i===1?'closed':i===2?'draft':'open',createdAt:i+1,title:job.title+(i===1?' with a longer multi-line role title and international locations':'')}));
 await page.route('**/api/hub/jobs',route=>route.fulfill({json:{data:mixed}}));
 for(const width of [320,390,768,1280,1728]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/?view=jobs');
  await page.locator('.hub-job-row').last().waitFor();
  const rows=page.locator('.hub-job-row');
  assert.match(await rows.first().locator('h3').innerText(),/Synthetic job 7/);
  const links=await rows.getByRole('link',{name:/View applicants for/}).evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
  assert.ok(Math.max(...links.map(r=>r.x))-Math.min(...links.map(r=>r.x))<2,'View applicants uses one consistent column');
  assert.ok(Math.max(...links.map(r=>r.width))-Math.min(...links.map(r=>r.width))<2,'Applicant buttons have equal width');
  for(const row of await rows.all()){
   const controls=await row.locator('.hub-job-actions > a,.hub-job-actions > button,.hub-job-menu > summary').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
   for(let i=1;i<controls.length;i++)assert.ok(controls[i].left-controls[i-1].right>=7,'Actions retain separate targets');
  }
  await noOverflow(page);await artifact(page,'job-action-columns-'+width);
 }
 assert.deepEqual(errors,[]);
});


test('job setup keeps its header compact and sections visible at desktop and mobile widths', async t=>{
 const {page,origin,errors}=await setup(t);
 for(const width of [320,390,640,1280,1728]){
  await page.setViewportSize({width,height:900}); await page.goto(origin+'/?view=jobs');
  await page.getByRole('button',{name:'Create job',exact:true}).click();
  await page.getByRole('button',{name:'Create blank job',exact:true}).click();
  await page.getByLabel('Job title',{exact:true}).waitFor();
  const geometry=await page.locator('section[aria-labelledby="wizard-title"]').evaluate(section=>{
   const rect=selector=>section.querySelector(selector).getBoundingClientRect().toJSON();
   return {root:section.getBoundingClientRect().toJSON(),status:rect('.hub-draft-status'),back:rect('.hub-back'),heading:rect('.hub-section-heading'),steps:rect('.hub-wizard-steps'),buttons:[...section.querySelectorAll('.hub-wizard-steps button')].map(e=>e.getBoundingClientRect().toJSON()),active:getComputedStyle(section.querySelector('[aria-current="step"] button')).backgroundColor};
  });
  assert.ok(Math.abs(geometry.status.top-geometry.back.top)<2,'Draft status and back share the utility row '+JSON.stringify(geometry));
  assert.ok(geometry.buttons.every(b=>b.height>=44),'Section controls retain 44px touch targets');
  assert.notEqual(geometry.active,'rgba(0, 0, 0, 0)','Current section is visually distinct');
  if(width>=1280){
   assert.ok(Math.max(...geometry.buttons.map(b=>b.top))-Math.min(...geometry.buttons.map(b=>b.top))<2,'All four sections share a row');
   assert.ok(geometry.steps.bottom-geometry.root.top<240,'Header does not consume the desktop form viewport');
  }else assert.ok(geometry.steps.height<140,'Mobile section tabs use two compact rows');
  await noOverflow(page);await artifact(page,'compact-wizard-'+width);
 }
 assert.deepEqual(errors,[]);
});


test('save toolbar and section navigation remain separate with compact screening summaries',async t=>{
 const {page,origin,errors}=await setup(t);
 const source=readFileSync('lib/country-regions.ts','utf8');const codes=[...source.matchAll(/name:"(?:Europe|North America)",codes:"([^"]+)"/g)].flatMap(m=>m[1].split(' '));
 const job={...jobs[0],fields:[{path:'country_of_residence',title:'Country of residence',type:'ValueSelect',required:true,options:codes.map(value=>({value,label:value}))},{path:'budget',title:'Managed budget',type:'Number',required:true,numberFormat:'currency',currency:'USD'}],rules:[{fieldPath:'country_of_residence',operator:'in',value:codes,enabled:true,reason:'Eligible countries'},{fieldPath:'budget',operator:'gte',value:30000,enabled:true,reason:'Budget'}]};
 await page.route('**/api/hub/jobs',r=>r.fulfill({json:{data:[job]}}));
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/?view=jobs');await page.getByRole('button',{name:'Edit job',exact:true}).click();
  const steps=page.getByRole('list',{name:'Job setup progress'}),save=page.getByRole('group',{name:'Job save actions'}),nav=page.getByRole('navigation',{name:'Job section navigation'});
  for(const label of ['Job details','Application questions','Review settings','Preview & publish']){
   await steps.getByRole('button',{name:label,exact:true}).click();assert.equal(await save.getByRole('button',{name:'Save changes',exact:true}).count(),1);assert.equal(await nav.getByRole('button',{name:/Save|Publish|Cancel/}).count(),0);await noOverflow(page);
  }
  const summary=page.getByRole('region',{name:'Screening requirements',exact:true});await summary.getByText('Europe · North America',{exact:true}).waitFor();await summary.getByText('$30,000.00',{exact:true}).waitFor();assert.equal(await summary.locator('details').evaluate(e=>e.open),false);assert.ok((await summary.boundingBox()).height<360);await summary.locator('summary').click();await noOverflow(page);await summary.locator('summary').click();
  await page.evaluate(()=>scrollTo(0,0));await artifact(page,'final-wizard-preview-'+width);assert.equal(await page.locator('.hub-job-editor-heading').evaluate(e=>getComputedStyle(e).position),width>640?'sticky':'static');
 }
 assert.deepEqual(errors,[]);
});
