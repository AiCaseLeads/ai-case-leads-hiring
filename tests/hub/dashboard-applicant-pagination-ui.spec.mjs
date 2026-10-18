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
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={{email:'owner@example.invalid',role:'admin'}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8')+'\n'+readFileSync('components/hub/applications.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main class="hub-main"><div id="root"></div></main><script src="/bundle.js"></script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(5000);const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const url=new URL(route.request().url());requests.push(url);let data={};if(url.pathname==='/api/hub/overview')data={counts:{applications:500,active:500,rejected:0,hired:0},stageCounts:[],recentApplications:[],integrations:{google:true,drive:true,applicationsEnabled:true},jobs};if(url.pathname==='/api/hub/application-counts')data={items:[]};if(url.pathname==='/api/hub/applications')data={items:[{...applicant,id:'app-'+(url.searchParams.get('page')||'1')}],total,page:Number(url.searchParams.get('page')||1),pageSize};if(url.pathname==='/api/ai/match')data={jobId:'job-one',enabled:false,available:true,status:'disabled',version:1,criteria:[]};return route.fulfill({json:{data}});});
 await page.goto(`http://127.0.0.1:${server.address().port}/team?view=applications&${initialFilter||"jobId=job-one"}`);return{page,requests,errors};
}


test('real dashboard retains all-page download selection across 20 pages, dates, history and reload',async t=>{
 const{page,requests,errors}=await setup(t,{width:1280,total:500,pageSize:25});
 await page.getByRole('button',{name:'Synthetic Applicant',exact:true}).waitFor();
 await page.getByLabel('Screening',{exact:true}).selectOption('pass');
 await page.getByLabel('Applied from',{exact:true}).fill('2026-10-15');
 await page.getByLabel('Applied through',{exact:true}).fill('2026-10-17');
 await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 await page.getByText('Page 1 of 20 · 500 matching applicants',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('appliedFrom'),'2026-10-15');
 assert.equal(new URL(page.url()).searchParams.get('appliedTo'),'2026-10-17');
 await page.getByRole('button',{name:'Select all matching for download (500)',exact:true}).click();
 for(let n=2;n<=20;n++){
   await page.getByRole('button',{name:'Next',exact:true}).click();
   await page.getByText(`Page ${n} of 20 · 500 matching applicants`,{exact:true}).waitFor();
   assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true,'selection page '+n);
   assert.equal(new URL(page.url()).searchParams.get('page'),String(n));
   assert.equal(new URL(page.url()).searchParams.get('qualification'),'pass');
   await page.locator('.hub-selection-banner').waitFor();
 }
 const exports=[];
 await page.route('**/api/hub/applications-export?*',route=>{const url=new URL(route.request().url());exports.push(url);return route.fulfill(url.searchParams.has('check')?{json:{data:{count:500}}}:{headers:{'Content-Disposition':'attachment; filename=test.zip'},body:'controlled test'});});
 await page.getByRole('button',{name:'Download applications (ZIP)',exact:true}).click();
 await page.getByText(/Application files download started/).waitFor();
 assert.ok(exports.length>=1);for(const url of exports){assert.equal(url.searchParams.get('qualification'),'pass');assert.equal(url.searchParams.get('appliedFrom'),'2026-10-15');assert.equal(url.searchParams.get('appliedTo'),'2026-10-17');assert.equal(url.searchParams.has('page'),false);assert.equal(url.searchParams.has('ids'),false);}
 await page.goBack();await page.getByText('Page 19 of 20 · 500 matching applicants',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Select Synthetic Applicant',{exact:true}).isChecked(),true);
 await page.goForward();await page.getByText('Page 20 of 20 · 500 matching applicants',{exact:true}).waitFor();
 await page.reload();await page.getByText('Page 20 of 20 · 500 matching applicants',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Applied from',{exact:true}).inputValue(),'2026-10-15');assert.equal(await page.getByLabel('Screening',{exact:true}).inputValue(),'pass');
 const query=requests.filter(r=>r.pathname==='/api/hub/applications').at(-1).searchParams;assert.equal(query.get('appliedTo'),'2026-10-17');assert.equal(query.get('page'),'20');assert.deepEqual(errors,[]);
});
