import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

test('compiled dashboard layout fits narrow screens across jobs, reports and settings',async t=>{
 const member={email:'head-recruiter-with-a-long-name@example.invalid',role:'admin',isOwner:true};
 const job={id:'job1',title:'Senior Creative Strategist for International Marketing Teams',slug:'creative',status:'open',location:'Remote — Spain and United States',archiveProject:'Creative',archiveCountry:'Spain',hiringRound:'October',fields:[],rules:[],descriptionHtml:'Role description',department:'Marketing'};
 const overview={counts:{applications:7,active:6,rejected:1,hired:0},stageCounts:[],recentApplications:[],integrations:{google:true,drive:true,applicationsEnabled:true},jobs:[job]};
 const availability={timeZone:'America/Bogota',weekdays:[1,2,3,4,5],startHour:10,endHour:16,durationMinutes:30,minimumNoticeHours:2,horizonDays:14};
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify(member)}} signOutHref="/logout"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(route.request().method()!=='GET')writes.push(path);let data={};
 if(path==='/api/hub/overview')data=overview;
 if(path==='/api/hub/recruiting-help')data={items:[],hasMore:false};
 if(path==='/api/hub/jobs')data=[job];
 if(path==='/api/review-reminders')data={total:0,staff:[],config:{dueHours:48,enabled:false,fallbackAdmins:[]},applications:[]};
 if(path==='/api/hub/tasks')data=[{id:'task1',applicationId:'synthetic-app',kind:'gmail',status:'failed',attempts:0,lastError:'candidate_mail_account_connection_required',createdAt:1,updatedAt:1}];
 if(path==='/api/hub/settings')data={settingsVersion:1,members:[member],google:{connected:true,sender:member.email,calendarId:member.email,driveRootId:'shared'},queue:{pending:0,failed:0},templates:{rejection:''},applicationsEnabled:true};
 if(path==='/api/google/status')data={configured:true,hostingPlatform:'railway',backgroundEnabled:true,credentialsManaged:true};
 if(path==='/api/personal-calendar')data={email:member.email,connected:true,ready:true,calendarId:member.email,configured:true,availability,interviewers:[]};
 if(path==='/api/personal-mail')data={email:member.email,connected:true,configured:true,candidateConnected:false};
 if(path==='/api/team')data={canManageTeam:true,members:[{...member,active:true}]};
 if(path==='/api/scorecards')data={revision:0,templates:[],archived:[],bindings:{}};
 if(path==='/api/hub/reports')data={applications:1000,qualificationRate:.7,stageCounts:[],sources:[{source:'UnbrokenSource'.repeat(20),count:1000}],timeInStage:[],workload:[{assignee:member.email,count:1000}],attendance:{attended:3,total:4},conversion:[]};
 return route.fulfill({json:{data}});});
 const audit=async label=>{const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.hub-main button,.hub-main input,.hub-main select,.hub-main textarea,.hub-main .hub-card,.hub-main .hub-table-wrap')].filter(e=>e.getClientRects().length).filter(e=>e.matches('.hub-table-wrap')||!e.closest('.hub-table-wrap')).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>e.tagName+':'+e.textContent.slice(0,80))}));assert.ok(result.scroll<=result.width+1,`${label}: ${JSON.stringify(result)}`);assert.deepEqual(result.overflow,[],label);};
 for(const width of [320,390,768,1280,1728]){await page.setViewportSize({width,height:900});for(const view of ['overview','jobs','reports','tasks','settings']){await page.goto(`http://127.0.0.1:${server.address().port}/?view=${view}`);await page.locator('.hub-main h2').first().waitFor();await page.waitForTimeout(100);await audit(`${view} ${width}`);if(view==='settings')for(const section of ['Team access & invitations','Scorecard templates','Company setup','My setup']){await page.getByRole('button',{name:section,exact:true}).click();await page.waitForTimeout(100);await audit(`${section} ${width}`);if(section==='Company setup'){for(const summary of await page.locator('.hub-main details > summary').all()){await summary.click();await audit(`expanded ${await summary.textContent()} ${width}`);}}}}}
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
});
