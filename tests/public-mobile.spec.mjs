import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
const job={id:'synthetic',slug:'synthetic',title:'Senior Creative Strategist for International Performance Marketing',department:'Creative',location:'Remote · Worldwide',descriptionHtml:'<h2>About the role</h2>'+Array.from({length:22},(_,i)=>`<p>Responsibility ${i+1}: Review creative research, explain your reasoning, collaborate with our international team and document practical recommendations.</p>`).join('')};
const fields=[{path:'_systemfield_name',title:'First name',type:'String',required:true},{path:'_systemfield_email',title:'Email address',type:'Email',required:true},{path:'_systemfield_phone',title:'Phone number',type:'Phone',required:true},{path:'_systemfield_resume',title:'Résumé',type:'File',required:true}];
test('public homepage, complete role and application remain usable at phone/tablet widths',async t=>{
 const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css;
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CareersHome,CareerDetail}from'./components/careers/experience';createRoot(document.getElementById('root')).render(location.pathname==='/'?<CareersHome/>:<CareerDetail slug="synthetic"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
 const page=await browser.newPage({reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));let enabled=true;
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/form'))return route.fulfill({json:{fields,formVersion:1}});assert.equal(route.request().method(),'GET','No live or synthetic submissions');return route.fulfill({json:path==='/api/jobs'?{jobs:[job],mode:'live',submissionEnabled:enabled}:path.startsWith('/api/jobs/')?{job,mode:'live',submissionEnabled:enabled}:{required:false,configured:true}});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await page.goto(base);await page.getByRole('link',{name:job.title,exact:true}).waitFor();await noOverflow();
  await page.goto(base+'/jobs/synthetic');await page.getByRole('heading',{name:job.title,exact:true}).waitFor();await noOverflow();assert.equal(await page.locator('.description-copy p').count(),22);
  const cta=page.getByRole('link',{name:'Apply for this job',exact:true});
  if(width<=640){await cta.waitFor();assert.ok((await cta.boundingBox()).height>=44);await page.screenshot({path:`/tmp/public-job-${width}.png`});await cta.click();await page.waitForFunction(()=>document.activeElement?.id==='job-application');await page.waitForFunction(()=>!document.querySelector('.mobile-apply-bar'));}
  else {assert.equal(await cta.count(),0);await page.getByRole('link',{name:'Go to application',exact:true}).click();}
  await page.locator('#job-application').scrollIntoViewIfNeeded();await noOverflow();await page.getByRole('button',{name:'Continue to application'}).click();await page.getByLabel('First name',{exact:false}).fill('Synthetic');await noOverflow();assert.equal(await cta.count(),0);await page.screenshot({path:`/tmp/public-form-${width}.png`});
  await page.locator('footer').scrollIntoViewIfNeeded();assert.equal(await cta.count(),0);
 }
 enabled=false;await page.setViewportSize({width:390,height:844});await page.goto(base+'/jobs/synthetic');await page.getByRole('heading',{name:job.title,exact:true}).waitFor();assert.equal(await page.locator('.mobile-apply-bar').count(),0);assert.deepEqual(errors,[]);
});
