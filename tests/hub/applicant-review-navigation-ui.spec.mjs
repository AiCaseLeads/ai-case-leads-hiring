import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const job={id:'job-1',title:'Synthetic Engineer',slug:'engineer',status:'open',aiMatchEnabled:true,fields:[],rules:[]};
const record=id=>({id,revision:1,name:`Applicant ${id}`,email:'synthetic@example.invalid',jobId:job.id,jobTitle:job.title,stage:'Application Review',qualification:'pass',createdAt:1,assignee:null,fields:[{path:'_systemfield_resume',type:'File',title:'Résumé',required:false},{path:'portfolio',type:'File',title:'Portfolio',required:false}],answers:[],files:[{id:'portfolio',fieldPath:'portfolio',filename:'portfolio.pdf',url:'/api/files/portfolio',contentType:'application/pdf',size:100},{id:'resume',fieldPath:'_systemfield_resume',filename:'resume.pdf',url:'/api/files/resume',contentType:'application/pdf',size:100}],history:[],notes:[],scorecards:[],communications:[],qualificationEvidence:[]});
async function setup(t,{failViewed=false,failPreview=false,width=1280}={}){
 const {outputFiles}=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={{email:'reviewer@example.invalid',role:'admin'}} signOutHref='/logout'/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+readFileSync('components/hub/hub.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(5000);const writes=[],navigation=[],views=new Set();
 await page.route('**/api/**',route=>{const req=route.request(),u=new URL(req.url());let data={};
 if(u.pathname==='/api/hub/overview')data={jobs:[job],stageCounts:[],recent:[],tasks:[],applicationCount:2,integrations:{applicationsEnabled:true}};
 else if(u.pathname==='/api/hub/application-counts')data={items:[{jobId:job.id,total:51}]};
 else if(u.pathname.endsWith('/navigation')){navigation.push(u);const id=u.pathname.split('/')[4];data={previousId:id==='app-1'?null:'app-1',nextId:id==='app-1'?'app-2':null,position:id==='app-1'?50:51,total:51};}
 else if(u.pathname.endsWith('/viewed')){writes.push(u.pathname);if(failViewed)return route.fulfill({status:503,json:{error:{message:'unavailable'}}});views.add(u.pathname.split('/')[4]);data={viewedAt:123};}
 else if(u.pathname==='/api/hub/applications')data={items:[{...record('app-1'),viewedAt:views.has('app-1')?123:null}],total:51,page:2,pageSize:25};
 else if(u.pathname.startsWith('/api/hub/applications/'))data={...record(u.pathname.split('/')[4]),viewedAt:views.has(u.pathname.split('/')[4])?123:null};
 else if(u.pathname.startsWith('/api/files/'))return route.fulfill({status:failPreview?403:200,contentType:failPreview?'application/json':'application/pdf',body:failPreview?'{}':'%PDF-1.4\n%%EOF'});
 else if(u.pathname==='/api/ai/match')data={enabled:false,status:'disabled',criteria:[]};
 else if(u.pathname==='/api/scorecards')data={template:null,revision:1};
 return route.fulfill({json:{data}});});
 await page.goto(`http://127.0.0.1:${server.address().port}/team?view=applications&jobId=job-1&qualification=pass&appliedFrom=2026-10-15&appliedTo=2026-10-18&timeZone=America%2FBogota&page=2`);
 await page.getByRole('button',{name:'Applicant app-1',exact:true}).waitFor();return{page,writes,navigation};
}
test('actual dashboard preserves filtered AI order across page boundary, marks viewed without stage changes, and guards unsaved notes',async t=>{
 const{page,writes,navigation}=await setup(t);await page.getByRole('button',{name:'Applicant app-1',exact:true}).click();await page.getByText('Applicant 50 of 51 matching results',{exact:true}).waitFor();await page.getByText('Viewed by you',{exact:true}).waitFor();
 const query=navigation.at(-1).searchParams;assert.equal(query.get('sort'),'ai_match_desc');assert.equal(query.get('qualification'),'pass');assert.equal(query.get('appliedFrom'),'2026-10-15');assert.equal(query.get('timeZone'),'America/Bogota');assert.equal(query.has('page'),false);
 await page.getByRole('button',{name:'Add note',exact:true}).first().click();await page.getByLabel('Internal note',{exact:true}).fill('Unsaved note');await page.getByRole('button',{name:'Next applicant',exact:true}).click();await page.getByRole('alertdialog').waitFor();assert.equal(new URL(page.url()).searchParams.get('application'),'app-1');await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.getByLabel('Internal note',{exact:true}).inputValue(),'Unsaved note');
 await page.getByRole('button',{name:'Next applicant',exact:true}).click();await page.getByRole('button',{name:'Discard changes and leave',exact:true}).click();await page.getByRole('heading',{name:'Applicant app-2',exact:true}).waitFor();await page.getByText('Applicant 51 of 51 matching results',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Next applicant',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Back to applications',exact:true}).click();await page.getByRole('button',{name:'Applicant app-1',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('page'),'2');assert.equal(new URL(page.url()).searchParams.get('qualification'),'pass');await page.getByText('Viewed',{exact:true}).waitFor();assert.ok(writes.every(path=>path.endsWith('/viewed')));
});
test('resume preview chooses resume field, stays bounded on mobile and never uses external viewer',async t=>{
 const{page}=await setup(t,{width:390});await page.getByRole('button',{name:'Applicant app-1',exact:true}).click();await page.getByRole('button',{name:'View résumé',exact:true}).click();const frame=page.getByTitle('Résumé preview: resume.pdf',{exact:true});await frame.waitFor();assert.equal(await frame.getAttribute('src'),'/api/files/resume?preview=1');assert.equal(await page.locator('iframe[src*="portfolio"]').count(),0);assert.ok((await frame.boundingBox()).height<=700);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
});
test('view and preview failures leave application usable with explicit retry/download',async t=>{
 const{page}=await setup(t,{failViewed:true,failPreview:true});await page.getByRole('button',{name:'Applicant app-1',exact:true}).click();await page.getByRole('button',{name:'Retry viewed status',exact:true}).waitFor();await page.getByRole('button',{name:'View résumé',exact:true}).click();await page.getByText('Preview is unavailable. Use Download résumé or refresh to retry.',{exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);await page.getByRole('link',{name:'Download résumé',exact:true}).waitFor();await page.getByRole('button',{name:'Next applicant',exact:true}).click();await page.getByRole('heading',{name:'Applicant app-2',exact:true}).waitFor();
});
