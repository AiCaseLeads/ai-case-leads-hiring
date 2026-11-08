import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

const owner={email:'owner@example.invalid',role:'admin',isOwner:true};
const availability={timeZone:'America/Bogota',weekdays:[1,2,3,4,5],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14};
const settings={settingsVersion:7,members:[owner],google:{connected:true,sender:owner.email,expectedSender:owner.email,calendarId:owner.email,driveRootId:'shared-folder'},queue:{pending:3,failed:2},templates:{rejection:'Thank you for applying.'},applicationsEnabled:true,scheduling:{...availability,configured:true,remindersEnabled:false}};
const report={applications:10,qualificationRate:.4,attendance:{total:4,attended:3},stageCounts:[{stage:'Application Review',count:6},{stage:'Screening',count:3},{stage:'Hired',count:1}],conversion:[{stage:'Application Review',count:10},{stage:'Screening',count:4}],sources:[{source:'LinkedIn',count:10,qualified:4,interviewed:2,hired:1,qualificationRate:.4}],timeInStage:[{stage:'Application Review',averageHours:48.5}],workload:[{assignee:owner.email,count:3},{assignee:'',count:7}]};
let css;
async function setup(t,{mode='settings',member=owner}={}){
 css ??= (await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8');
 const entry=mode==='reports'?`import{Reports}from'./components/hub/reports';createRoot(document.getElementById('root')).render(<Reports refresh={0}/>);`:`import{HubSettings}from'./components/hub/settings';createRoot(document.getElementById('root')).render(<HubSettings member={${JSON.stringify(member)}} refresh={0} changed={()=>{}} onDeliveryActivity={()=>document.body.dataset.delivery='opened'}/>);`;
 const{outputFiles}=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';${entry}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div class="hub-main"><div id="root"></div></div><script src="/bundle.js"></script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);const writes=[],reads=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;reads.push(path);if(route.request().method()!=='GET'){writes.push({path,input:route.request().postDataJSON()});return route.fulfill({status:409,json:{error:{message:'Settings changed. Refresh and try again.'}}});}
 const data=path==='/api/hub/settings'?settings:path==='/api/hub/reports'?report:path==='/api/personal-calendar'?{email:member.email,connected:true,ready:true,calendarId:member.email,configured:true,availability,interviewers:[]}:path==='/api/personal-mail'?{email:member.email,configured:true,connected:false,candidateAccount:'recruiter@example.invalid',candidateConnected:false}:path==='/api/transactional-mail'?{provider:'sendgrid',sender:'no-reply-recruiting@aicaseleads.com',configured:false,ready:false,error:'transactional_mail_key_required',checkedAt:null,dailyLimit:300,setupUrl:'https://app.sendgrid.com'}:path==='/api/google/status'?{configured:true,hostingPlatform:'railway',backgroundEnabled:true,credentialsManaged:true}:path==='/api/ai/config'?{configured:true,enabled:true,model:'openai/gpt-5-mini',provider:'openrouter'}:path==='/api/hub/recruiting-help'?{items:[],hasMore:false}:{};return route.fulfill({json:{data}});
 });await page.goto(`http://127.0.0.1:${server.address().port}`);return{page,writes,reads,errors};
}

test('settings opens focused personal connections and loads help requests only when requested',async t=>{
 const{page,reads,writes,errors}=await setup(t,{member:{email:'recruiter@example.invalid',role:'recruiter'}});
 await page.getByRole('heading',{name:'My interview calendar'}).waitFor();
 const firstHour=page.getByLabel('First available hour');
 await firstHour.selectOption({label:'4 PM'});
 assert.equal(await firstHour.inputValue(),'16');
 assert.equal(await firstHour.locator('option[value="0"]').innerText(),'12 AM');
 assert.equal(await firstHour.locator('option[value="12"]').innerText(),'12 PM');
 assert.equal(await page.getByLabel('Finish by').locator('option[value="24"]').innerText(),'12 AM (end of day)');

 assert.equal(await page.getByRole('heading',{name:/Welcome/}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Company',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Team',exact:true}).count(),0);
 assert.equal(reads.includes('/api/hub/settings'),false);assert.equal(reads.includes('/api/hub/recruiting-help'),false);
 await page.getByRole('button',{name:'Help requests',exact:true}).click();await page.getByRole('heading',{name:'Applicant help & privacy requests',exact:true}).waitFor();
 assert.equal(reads.includes('/api/hub/recruiting-help'),true);assert.equal(await page.getByRole('heading',{name:'My interview calendar'}).count(),0);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});

test('company sections retain edits, keep secrets hidden and preserve revision on a failed save',async t=>{
 const{page,writes,errors}=await setup(t);await page.getByRole('button',{name:'Company',exact:true}).click();
 await page.getByRole('heading',{name:'Applicant file storage',exact:true}).waitFor();await page.getByRole('alert').filter({hasText:'2 delivery tasks need attention.'}).waitFor();
 await page.getByRole('button',{name:'View delivery activity',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-delivery'),'opened');
 assert.equal(await page.getByText('Shared interview calendar (optional)',{exact:true}).evaluate(e=>e.parentElement.open),false);
 await page.getByLabel('Shared Google Drive folder',{exact:true}).fill('https://drive.google.com/drive/folders/another-folder');
 await page.getByRole('button',{name:'Messages & reminders',exact:true}).click();const editor=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Default rejection message'})});assert.equal(await editor.evaluate(e=>e.open),false);await editor.locator('summary').click();await page.getByLabel('Approved template',{exact:true}).fill('A revised rejection message.');await editor.locator('summary').click();assert.equal(await editor.evaluate(e=>e.open),false);await editor.locator('summary').click();assert.equal(await page.getByLabel('Approved template',{exact:true}).inputValue(),'A revised rejection message.');await editor.locator('summary').click();
 await page.getByRole('button',{name:'AI',exact:true}).click();assert.equal(await page.getByLabel('Replace OpenRouter API key (optional)',{exact:true}).inputValue(),'');
 await page.getByRole('button',{name:'Files & calendar',exact:true}).click();assert.equal(await page.getByLabel('Shared Google Drive folder',{exact:true}).inputValue(),'https://drive.google.com/drive/folders/another-folder');
 await page.getByRole('button',{name:'Save company settings',exact:true}).click();await page.getByRole('alert').filter({hasText:'Settings changed.'}).waitFor();
 assert.equal(writes.length,1);assert.deepEqual(writes[0].input,{settingsVersion:7,calendarId:owner.email,driveRootId:'another-folder',rejectionTemplate:'A revised rejection message.',interviewTimeZone:'America/Bogota',interviewStartHour:10,interviewEndHour:16,interviewDurationMinutes:30,interviewWeekdays:[1,2,3,4,5],interviewRemindersEnabled:false});
 assert.equal(await page.getByLabel('Shared Google Drive folder',{exact:true}).inputValue(),'https://drive.google.com/drive/folders/another-folder');assert.deepEqual(errors,[]);
});

test('report sections distinguish screening from recruiter decisions and fit narrow layouts',async t=>{
 const{page,writes,errors}=await setup(t,{mode:'reports'});await page.locator('.hub-metric strong').filter({hasText:'40.0%'}).waitFor();
 assert.equal(await page.getByText('This does not mean a recruiter has reviewed the applicant.',{exact:false}).count(),1);
 await page.getByRole('heading',{name:'Current pipeline',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'New',exact:true}).count(),2);
 assert.equal(await page.getByRole('heading',{name:'Application sources',exact:true}).count(),0);
 await page.getByRole('button',{name:'Sources',exact:true}).click();await page.getByRole('heading',{name:'Application sources',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'LinkedIn',exact:true}).count(),1);
 await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByRole('heading',{name:'Assigned applicants',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'Unassigned',exact:true}).count(),1);
 for(const width of[320,390,768,1280]){await page.setViewportSize({width,height:844});for(const section of['Overview','Sources','Team']){await page.getByRole('button',{name:section,exact:true}).click();const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,`${section} ${width}: ${JSON.stringify(dimensions)}`);}}
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});


test('head recruiter can check automatic mail in Company without loading owner configuration',async t=>{
 const{page,reads,writes,errors}=await setup(t,{member:{email:'mariam@example.invalid',role:'admin',isOwner:false}});
 await page.getByRole('button',{name:'Company',exact:true}).click();await page.getByRole('heading',{name:'Automatic applicant emails',exact:true}).waitFor();
 await page.getByText('Add the SendGrid API key to the hiring service’s Railway variables.',{exact:true}).waitFor();
 assert.equal(reads.includes('/api/hub/settings'),false);assert.equal(reads.includes('/api/google/status'),false);assert.equal(reads.includes('/api/transactional-mail'),true);
 assert.equal(await page.getByRole('heading',{name:'Company Google connection',exact:true}).count(),0);assert.equal(await page.locator('input[type="password"]').count(),0);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});


test('automatic email deep link opens Company directly and cannot expose Company to ordinary recruiters',async t=>{
 const{page,reads,errors}=await setup(t,{member:{email:'mariam@example.invalid',role:'admin',isOwner:false}});
 await page.goto(page.url()+'?section=company');await page.getByRole('heading',{name:'Automatic applicant emails',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Company',exact:true}).getAttribute('aria-current'),'page');
 assert.equal(reads.includes('/api/hub/settings'),false);assert.deepEqual(errors,[]);
 const ordinary=await setup(t,{member:{email:'recruiter@example.invalid',role:'recruiter'}});
 await ordinary.page.goto(ordinary.page.url()+'?section=company');await ordinary.page.getByRole('heading',{name:'My interview calendar'}).waitFor();
 assert.equal(await ordinary.page.getByRole('heading',{name:'Automatic applicant emails',exact:true}).count(),0);assert.equal(ordinary.reads.includes('/api/transactional-mail'),false);assert.deepEqual(ordinary.errors,[]);
});
