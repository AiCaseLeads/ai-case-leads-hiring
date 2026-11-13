import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {existsSync} from 'node:fs';
test('application questions appear only after verified challenge and failures can retry on mobile',async t=>{
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ApplicationGate}from'./components/careers/application-gate';createRoot(document.getElementById('root')).render(<ApplicationGate job={{id:'job-id',slug:'role',title:'Role',department:'Test'}} enabled/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?outputFiles[0].text:'<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main><script src="/app.js"></script>')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.addInitScript(()=>{window.turnstile={render:(_el,options)=>{setTimeout(()=>options.callback('test-challenge'),0);return 'widget'},remove:()=>{}}});await page.route('https://challenges.cloudflare.com/**',route=>route.fulfill({body:''}));let failed=true,forms=0;
 await page.route('**/api/application-verification',route=>{if(route.request().method()==='GET')return route.fulfill({json:{required:true,configured:true,siteKey:'test'}});if(failed){failed=false;return route.fulfill({status:503,json:{error:{message:'Verification temporarily unavailable'}}})}return route.fulfill({json:{grant:'verified-grant',expiresAt:Date.now()+1800000}})});
 await page.route('**/api/jobs/role/form',route=>{forms++;assert.equal(route.request().postDataJSON().grant,'verified-grant');return route.fulfill({json:{fields:[{path:'answer',title:'Private question',type:'LongText',required:true}],formVersion:1}})});
 await page.goto(`http://127.0.0.1:${server.address().port}`);assert.equal(await page.getByLabel('Private question').count(),0);const button=page.getByRole('button',{name:'Continue to application'});await button.click();await page.getByRole('alert').getByText('Verification temporarily unavailable').waitFor();assert.equal(forms,0);await button.click();await page.getByLabel('Private question').waitFor();assert.equal(forms,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
});
