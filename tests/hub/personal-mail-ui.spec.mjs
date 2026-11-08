import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';

async function setup(t,{email='mariam@example.com',configured=true}={}){
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PersonalMailSetup}from'./components/hub/personal-mail';createRoot(document.getElementById('root')).render(<PersonalMailSetup member={{email:${JSON.stringify(email)},role:'admin',userId:'reviewer',isOwner:true}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[];let connected=false;
 await page.route('**/api/personal-mail',route=>route.fulfill({json:{data:{email,candidateAccount:email,configured,connected,canConnect:true,connectedAt:null}}}));
 await page.route('**/api/personal-mail/connect',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:503,json:{error:{message:'Please retry Google authorization.'}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 return {page,writes,setConnected:()=>{connected=true}};
}

test('recruiter email setup separates own account from automatic mail, preserves server failure and refreshes readiness',async t=>{
 const {page,writes,setConnected}=await setup(t);
 await page.getByRole('button',{name:'Connect recruiting email',exact:true}).click();await page.getByRole('alert').waitFor();assert.deepEqual(writes,[{}]);
 assert.equal(await page.getByText('Automatic receipts and rejections use SendGrid.',{exact:false}).count(),1);
 assert.equal(await page.getByText('Automatic applicant email is assigned to',{exact:false}).count(),0);
 await page.getByText('What Google permissions allow',{exact:true}).click();assert.equal(await page.getByText('Google’s permission applies to your mailbox.',{exact:false}).count(),1);
 setConnected();await page.getByRole('button',{name:'Refresh saved status'}).click();await page.getByRole('button',{name:'Reconnect recruiting email'}).waitFor();
});
test('owner can connect their own Gmail for invitations and reply routing',async t=>{
 const {page,writes,setConnected}=await setup(t,{email:'sales@aicaseleads.com'});
 const connect=page.getByRole('button',{name:'Connect recruiting email',exact:true});await connect.waitFor();assert.equal(await connect.isEnabled(),true);
 await page.getByText('sales@aicaseleads.com',{exact:true}).waitFor();assert.equal(await page.getByText('Your account is excluded from applicant mail.',{exact:true}).count(),0);
 await connect.click();await page.getByRole('alert').filter({hasText:'Please retry Google authorization.'}).waitFor();assert.deepEqual(writes,[{}]);
 setConnected();await page.getByRole('button',{name:'Refresh saved status'}).click();await page.getByRole('button',{name:'Reconnect recruiting email',exact:true}).waitFor();
 await page.getByText('Connection saved',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
});
test('owner connection still requires company Google configuration',async t=>{
 const {page,writes}=await setup(t,{email:'sales@aicaseleads.com',configured:false});
 await page.getByRole('alert').filter({hasText:'complete Google app configuration'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Connect recruiting email',exact:true}).isDisabled(),true);assert.equal(writes.length,0);
});
