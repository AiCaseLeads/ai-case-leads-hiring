import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const owner='sales@aicaseleads.com';
async function setup(t,{mailReady=true,width=390,withMaria=false}={}){
 const {outputFiles}=await build({stdin:{contents:`import React,{useState,useCallback} from 'react';import{createRoot}from'react-dom/client';import{InterviewComposer}from'./components/hub/interview-composer';import{JobTeamFields}from'./components/hub/job-team';function App(){const[value,change]=useState(''),[ready,setReady]=useState(false),[payload,setPayload]=useState(null),[team,setTeam]=useState({members:['${owner}'],replyTo:null,notifyNewApplications:true,notifyAssessmentSubmissions:true,notifyReplies:true,notifyOverdueReviews:true});const dirty=useCallback(()=>{},[]);return <><InterviewComposer applicationId="app-owner" jobId="job-owner" name="Synthetic Applicant" jobTitle="Synthetic role" email="candidate@example.invalid" value={value} change={change} renew={false} reviewerEmail="${owner}" ready={setReady} draft={setPayload} dirty={dirty} cancel={()=>{}}/><button disabled={!ready} data-fingerprint={payload?.previewFingerprint}>Send booking link</button><JobTeamFields data={{staff:[{email:'${owner}',role:'admin'}],sender:'${owner}',config:null}} value={team} change={setTeam}/></>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width,height:844}}),previews=[];
 const readiness={sender:owner,cc:[owner],replyTo:[owner],mailReady,mailIssue:mailReady?null:'recruiter_email_not_connected',companyGoogleReady:true,sharedCalendarReady:false,renewCalendarReady:false,hasActiveInterview:false,interviewers:[{email:owner,ready:true},...(withMaria?[{email:'maria@aicaseleads.com',ready:true}]:[])]};
 const template={subject:'Interview invitation: {{jobTitle}}',body:'Hi {{name}},\nChoose a time: {{bookingLink}}',version:1,variables:['name','jobTitle','bookingLink']};
 await page.route('**/api/interview-template',route=>route.fulfill({json:{data:template}}));
 await page.route('**/api/interview-readiness?*',route=>route.fulfill({json:{data:{...readiness,replyTo:[new URL(route.request().url()).searchParams.get('interviewerEmail')||owner]}}}));
 await page.route('**/api/interview-preview',route=>{previews.push(route.request().postDataJSON());return route.fulfill({json:{data:{subject:'Interview invitation: Synthetic role',body:'Hi Synthetic Applicant,\nChoose a time: https://jobs.example.invalid/interview/abc123',bookingUrl:'https://jobs.example.invalid/interview/abc123',bookingToken:'abc123',fingerprint:'approved-preview',envelope:{sender:owner,to:'candidate@example.invalid',cc:[owner],replyTo:[route.request().postDataJSON().interviewerEmail||owner]},readiness}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'Interview setup',exact:true}).waitFor();
 return {page,previews};
}
for(const width of [390,1280])test(`owner invitation uses own calendar, previews copy/replies and enables send at ${width}px`,async t=>{
 const {page,previews}=await setup(t,{width});const send=page.getByRole('button',{name:'Send booking link',exact:true});
 await page.waitForFunction(()=>document.querySelector('select')?.value==='sales@aicaseleads.com');
 assert.equal(await page.getByRole('button',{name:'Preview email',exact:true}).count(),0);
 await page.getByLabel('Default reply contact',{exact:true}).selectOption(owner);assert.equal(await page.getByLabel('Default reply contact',{exact:true}).inputValue(),owner);
 await page.getByRole('heading',{name:'Email preview',exact:true}).waitFor();
 await page.getByRole('link',{name:'https://jobs.example.invalid/interview/abc123'}).waitFor();assert.equal(previews.at(-1).interviewerEmail,owner);
 const preview=page.getByRole('region',{name:'Email preview',exact:true});await preview.getByText('You are copied and receive replies.',{exact:true}).waitFor();
 assert.equal(await preview.getByText(owner,{exact:false}).count(),3);assert.equal(await send.isEnabled(),true);assert.equal(await send.getAttribute('data-fingerprint'),'approved-preview');
 await page.getByText('Customize this email',{exact:true}).click();await page.getByLabel('Email subject',{exact:true}).fill('Updated invitation: {{jobTitle}}');assert.equal(await send.isDisabled(),true);
});
test('disconnected owner is guided to their own Gmail setup, not told to assign another recruiter',async t=>{
 const {page}=await setup(t,{mailReady:false});await page.getByText('Connect your Gmail to send this invitation and receive replies.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Open my email setup',exact:true}).getAttribute('href'),'/team?view=settings&section=personal');
 assert.equal(await page.getByText('sales@aicaseleads.com',{exact:false}).count()>0,true);
 assert.equal(await page.getByText('Choose a recruiter who will handle candidate replies.',{exact:true}).count(),0);
 await page.getByRole('heading',{name:'Email preview',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Send booking link',exact:true}).isDisabled(),true);
});

test('choosing Maria updates the reply contact while keeping the owner sender and CC',async t=>{
 const {page,previews}=await setup(t,{withMaria:true});
 await page.getByLabel('Interviewer',{exact:true}).selectOption('maria@aicaseleads.com');
 await page.locator('p').filter({hasText:'Replies go to: maria@aicaseleads.com'}).waitFor();

 const preview=page.getByRole('region',{name:'Email preview',exact:true});
 await preview.locator('p').filter({hasText:'Reply-To: maria@aicaseleads.com'}).waitFor();
 assert.equal(previews.at(-1).interviewerEmail,'maria@aicaseleads.com');
 await preview.getByText('Replies go to the selected interviewer. Reply all includes you.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Send booking link',exact:true}).isEnabled(),true);
});
