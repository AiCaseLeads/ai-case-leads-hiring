import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
for(const width of [390,1280])test(`connection editor preserves publishing when adding reads and can remove expiry at ${width}px`,async t=>{
 const {outputFiles}=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{AgentAccess}from './components/hub/agent-access';createRoot(document.getElementById('root')).render(<AgentAccess isOwner/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width,height:900}});let entry={id:'test-connection',name:'Claude Code',scopes:['jobs:read','jobs:draft','jobs:publish'],expiresAt:Date.now()+86400000,revoked:false};let writes=[];
 await page.route('**/api/agent-access',route=>{if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();writes.push(body);entry={...entry,scopes:body.scopes,expiresAt:body.noExpiry?null:entry.expiresAt};return route.fulfill({json:{data:entry}})}return route.fulfill({json:{data:[entry]}})});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Edit permissions'}).click();assert.equal(await page.getByRole('checkbox',{name:'Publish reviewed jobs'}).isChecked(),true);
 await page.getByRole('checkbox',{name:/Read applicants/}).check();await page.getByRole('checkbox',{name:/Read original uploaded files/}).check();await page.getByRole('checkbox',{name:/No expiry/}).check();await page.getByRole('button',{name:'Save permissions'}).click();await page.getByText('No expiry · Active until revoked',{exact:true}).waitFor();
 assert.deepEqual(writes[0],{id:entry.id,scopes:['jobs:read','jobs:draft','jobs:publish','applicants:read','files:read'],noExpiry:true});
});
