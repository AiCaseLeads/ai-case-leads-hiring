import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
test('delivery setup separates recruiter Gmail from automatic SendGrid and requires explicit recovery review',async t=>{
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Tasks}from'./components/hub/settings';createRoot(document.getElementById('root')).render(<Tasks admin={true} refresh={0} changed={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});const page=await browser.newPage();
 let ready=false;const writes=[],reads=[];
 await page.route('**/api/transactional-mail',route=>{reads.push('/api/transactional-mail');return route.fulfill({json:{data:{provider:'sendgrid',sender:'no-reply-recruiting@aicaseleads.com',configured:ready,ready,error:ready?null:'transactional_mail_key_required',checkedAt:1,dailyLimit:300,setupUrl:'https://app.sendgrid.com'}}});});
 await page.route('**/api/personal-mail',route=>{reads.push('/api/personal-mail');return route.fulfill({json:{data:{connected:false}}});});
 await page.route('**/api/hub/tasks/*/retry',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:409,json:{error:{message:'Review required'}}});});
 await page.route('**/api/hub/tasks?*',route=>route.fulfill({json:{data:[{id:'gmail:app1:manual:note',applicationId:'app1',kind:'gmail',status:'failed',attempts:1,updatedAt:1,lastError:'candidate_mail_account_connection_required'},{id:'gmail:app2:confirmation',applicationId:'app2',kind:'gmail',status:'failed',attempts:1,updatedAt:1,lastError:'gmail_sender_alias_not_verified'}]}}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText(/Automatic applicant emails need SendGrid setup/).waitFor();await page.getByText(/Connect the assigned recruiter’s Gmail for recruiter conversations/).waitFor();await page.getByText(/This earlier automatic applicant email now uses SendGrid/).waitFor();assert.equal(await page.getByRole('button',{name:'Retry safely',exact:true}).count(),0);assert.equal(await page.getByText('Setup required',{exact:true}).count(),2);assert.equal(await page.getByText('candidate_mail_account_connection_required',{exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Open automatic email setup'}).getAttribute('href'),'/team?view=settings&section=company');assert.equal(reads.includes('/api/personal-mail'),false);
 const recruiter=page.getByRole('row').filter({has:page.getByText('app1',{exact:true})}),automatic=page.getByRole('row').filter({has:page.getByText('app2',{exact:true})});assert.equal(await recruiter.getByRole('link',{name:'Open email settings'}).getAttribute('href'),'/team?view=settings');assert.equal(await automatic.getByRole('link',{name:'Open email settings'}).getAttribute('href'),'/team?view=settings&section=company');
 assert.deepEqual(writes,[]);ready=true;await page.reload();await page.getByRole('button',{name:'Review and retry held message',exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Retry safely',exact:true}).count(),0);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Review and retry held message',exact:true}).first().click();assert.deepEqual(writes,[]);

});

test('Drive continuation is neutral saved progress while actual failures retain recovery',async t=>{
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Tasks}from'./components/hub/settings';createRoot(document.getElementById('root')).render(<Tasks admin={true} refresh={0} changed={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});const page=await browser.newPage();
 await page.route('**/api/transactional-mail',route=>route.fulfill({json:{data:{provider:'sendgrid',sender:'no-reply-recruiting@aicaseleads.com',configured:true,ready:true,error:null,checkedAt:1,dailyLimit:300,setupUrl:'https://app.sendgrid.com'}}}));
 await page.route('**/api/hub/tasks?*',route=>route.fulfill({json:{data:[
  {id:'pending',applicationId:'app-progress',kind:'drive',status:'pending',attempts:0,updatedAt:1,lastError:'drive_archive_continuation',continuation:true,phase:'legacy_pdf'},
  {id:'failed',applicationId:'app-failed',kind:'drive',status:'failed',attempts:2,updatedAt:1,lastError:'google_429',phase:'originals',providerStatus:429},
  {id:'failed-continuation',applicationId:'app-failed-continuation',kind:'drive',status:'failed',attempts:8,updatedAt:1,lastError:'drive_archive_continuation',continuation:true},
 ]}}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const pending=page.getByRole('row').filter({has:page.getByText('app-progress',{exact:true})});
 await pending.getByText('Archiving files',{exact:true}).waitFor();
 const progress=pending.getByRole('cell').filter({hasText:'Progress saved; the background worker will continue automatically.'});
 assert.equal(await progress.getAttribute('class'),'hub-muted');
 assert.equal(await pending.getByText('Creating a PDF of an earlier record',{exact:true}).count(),1);
 assert.equal(await pending.getByRole('button').count(),0);
 assert.equal(await pending.getByText('drive_archive_continuation',{exact:true}).count(),0);
 const failed=page.getByRole('row').filter({has:page.getByText('app-failed',{exact:true})});
 assert.equal(await failed.getByRole('cell').filter({hasText:'google_429'}).getAttribute('class'),'hub-task-error');
 assert.equal(await failed.getByText('Provider response: 429',{exact:true}).count(),1);
 assert.equal(await failed.getByRole('button',{name:'Retry safely',exact:true}).count(),1);
 const failedContinuation=page.getByRole('row').filter({has:page.getByText('app-failed-continuation',{exact:true})});
 assert.equal(await failedContinuation.getByText('failed',{exact:true}).count(),1);
 assert.equal(await failedContinuation.getByRole('button',{name:'Retry safely',exact:true}).count(),1);
 assert.equal(await failedContinuation.getByText('Archiving files',{exact:true}).count(),0);
 assert.equal(await page.getByRole('columnheader',{name:'Details',exact:true}).count(),1);
});
