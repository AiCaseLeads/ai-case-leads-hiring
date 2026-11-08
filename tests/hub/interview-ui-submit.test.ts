import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createStore,jobInput,applicationInput,MANAGER,currentAction} from './fixtures';
import {mailGrantKey} from '../../lib/personal-mail/service';
import {grantKey,availabilityKey,defaultAvailability} from '../../lib/personal-calendar/service';
import {configurationFingerprint} from '../../lib/google/config-state';
import * as hiringErrors from '../../lib/hiring/errors';
import {dispatchInterviewMail} from '../../lib/task-runner';
import {sha256} from '../../lib/hiring/crypto';

// Exercise CandidateDetail's actual form serialization against the real exported
// preview/send handlers. Only authentication and infrastructure resolution use
// synthetic dependencies; no provider or live applicant is contacted.
for(const changeTiming of ['before-preview','after-preview'])test(`full applicant UI submits via real handler with a concurrent change ${changeTiming}`,async t=>{
 const owner={...MANAGER,email:'sales@aicaseleads.com'},interviewer='interviewer@example.invalid';
 const env={GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_TOKEN_KEY:'b'.repeat(64),GOOGLE_CLIENT_REVISION:0,ADMIN_EMAILS:owner.email};
 const old=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS=owner.email;
 t.after(()=>{if(old===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=old;});
 const f=createStore();t.after(()=>f.database.close());
 const job=await f.store.saveJob(jobInput()),app=await f.store.acceptApplication(applicationInput(job.id)),fingerprint=await configurationFingerprint(env);
 await currentAction(f.store,app.id,{action:'stage',stage:'Screening'},owner);
 await f.store.stmt("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES(?,?,?,1,0,0)",'selected-interviewer',interviewer,'recruiter').run();
 for(const email of [owner.email,interviewer]){
  await f.store.setSetting(grantKey(email),{email,calendarId:email,sealedToken:'synthetic-calendar',revision:0,fingerprint,connectedAt:1});
  await f.store.setSetting(availabilityKey(email),defaultAvailability);
 }
 await f.store.setSetting(mailGrantKey(owner.email),{email:owner.email,sealedToken:'synthetic-mail',revision:0,fingerprint,connectedAt:1});
 f.database.prepare("UPDATE hub_tasks SET status='done'").run();
 const deliveries:{body:string;cc?:string[]}[]=[];
 const runtime=globalThis as typeof globalThis & {__interviewFixture?:unknown};runtime.__interviewFixture={store:f.store,owner,env,hiringErrors,
  dispatchInterviewMail:(store:typeof f.store,taskId:string,applicationId:string,owners:string[])=>dispatchInterviewMail(store,taskId,applicationId,owners,async()=>({
   sendMail:async(mail:{body:string;cc?:string[]})=>{deliveries.push(mail);return {messageId:'fixture-outgoing-message'}},
  } as unknown as import('../../lib/google/workspace').GoogleWorkspace)),
 };t.after(()=>{delete runtime.__interviewFixture;});
 const routeBundle=await build({stdin:{contents:`export {GET as sentLinkGET} from './app/api/interview-sent-link/route';export {POST as previewPOST} from './app/api/interview-preview/route';export {POST as invitationPOST} from './app/api/interview-invitations/route';export {GET as readinessGET} from './app/api/interview-readiness/route';export {GET as templateGET} from './app/api/interview-template/route';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'synthetic-auth-and-storage',setup(builder){builder.onResolve({filter:/^\.\.\/task-runner$/},()=>({path:'fixture-dispatch',namespace:'fixture'}));builder.onResolve({filter:/errors$/},args=>(args.path.endsWith('/hiring/errors')||(args.path==='./errors'&&args.importer.includes('/lib/hiring/')))?{path:'fixture-errors',namespace:'fixture'}:null);builder.onResolve({filter:/^@\/lib\/(hub\/auth|hub\/runtime|workspace-config)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='fixture-dispatch'?'export function dispatchInterviewMail(...args){return globalThis.__interviewFixture.dispatchInterviewMail(...args)}':args.path==='fixture-errors'?'export const {HiringError,configurationError,UncertainSubmissionError}=globalThis.__interviewFixture.hiringErrors':args.path.endsWith('/auth')?'export async function requireHubMember(request){if(request.headers.get("x-fixture-guest"))throw new globalThis.__interviewFixture.hiringErrors.HiringError("staff_access_required",403,"Sign in.");return globalThis.__interviewFixture.owner}':args.path.endsWith('/runtime')?'export async function getHubStore(){return globalThis.__interviewFixture.store}':'export async function resolvedWorkspaceEnv(){return globalThis.__interviewFixture.env}',loader:'js'}));}}]});
 const handlers=await import('data:text/javascript;base64,'+Buffer.from(routeBundle.outputFiles[0].text).toString('base64'));
 const frontend=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CandidateDetail}from'./components/hub/candidates';createRoot(document.getElementById('root')).render(<CandidateDetail id="${app.id}" initialAction="interview" reviewerEmail="${owner.email}" back={()=>{}} changed={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'}});
 const writes:{path:string;body:Record<string,unknown>;status:number}[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const origin=`http://${req.headers.host}`,url=new URL(req.url!,origin);
   if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(frontend.outputFiles[0].text);return;}
   if(!url.pathname.startsWith('/api/')){res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');return;}
   let response:Response;
   if(url.pathname.startsWith('/api/interview-')){
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);const body=Buffer.concat(chunks).toString();
    const request=new Request(url,{method:req.method,headers:new Headers(req.headers as Record<string,string>),...(body?{body}:{})});
    response=await (url.pathname==='/api/interview-preview'?handlers.previewPOST: url.pathname==='/api/interview-readiness'?handlers.readinessGET:url.pathname==='/api/interview-template'?handlers.templateGET:handlers.invitationPOST)(request);
    if(req.method==='POST')writes.push({path:url.pathname,body:JSON.parse(body),status:response.status});
   }else if(url.pathname===`/api/hub/applications/${app.id}`)response=Response.json({data:await f.store.getApplication(app.id)});
   else if(url.pathname.endsWith('/recruiter-review'))response=Response.json({data:{canApprove:true}});
   else response=Response.json({data:{}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:{message:error instanceof Error?error.message:'Synthetic server failure'}}));}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 // Chromium can keep a connection open between the two invitation cases.
 t.after(() => new Promise<void>(resolve => {
   server.close(() => resolve());
   server.closeAllConnections();
 }));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);
 const address=server.address();assert.ok(address&&typeof address!=='string');
 await page.goto(`http://127.0.0.1:${address.port}`);
 await page.getByLabel('Interviewer',{exact:true}).selectOption(interviewer);
 const send=page.getByRole('button',{name:'Send booking link',exact:true});
 await page.getByText('Customize this email',{exact:true}).click();
 await page.getByLabel('Email subject',{exact:true}).fill('Synthetic custom invitation: {{jobTitle}}');
 await page.getByText('Add internal note — not emailed',{exact:true}).click();
 await page.getByLabel('Internal recruiter note — not emailed',{exact:true}).fill('Synthetic private note');
 if(changeTiming==='before-preview')await currentAction(f.store,app.id,{action:'note',text:'Synthetic concurrent update before preview'},owner);

 await page.getByRole('region',{name:'Email preview',exact:true}).locator('p').filter({hasText:'Reply-To: '+interviewer}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Send booking link'&&!button.disabled));
 if(changeTiming==='after-preview'){
  await currentAction(f.store,app.id,{action:'note',text:'Synthetic concurrent update after preview'},owner);
  const conflict=page.waitForResponse(response=>response.url().endsWith('/api/interview-invitations'));await send.click();
  const failure=await conflict;assert.equal(failure.status(),409);assert.equal((await failure.json()).error.code,'record_changed');
  assert.equal((await f.store.getApplication(app.id)).interviews.length,0);
  assert.equal(await page.getByLabel('Internal recruiter note — not emailed',{exact:true}).inputValue(),'Synthetic private note');
  assert.equal(await page.getByLabel('Email subject',{exact:true}).inputValue(),'Synthetic custom invitation: {{jobTitle}}');

  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Send booking link'&&!button.disabled));
 }
 const displayedUrl=await page.getByRole('region',{name:'Email preview'}).getByRole('link').getAttribute('href');
 assert.ok(displayedUrl);
 const revisionBeforeSend=(await f.store.applicationRow(app.id)).revision;
 const submitted=page.waitForResponse(response=>response.url().endsWith('/api/interview-invitations'));
 await send.click();
 const response=await submitted;assert.equal(response.status(),200,JSON.stringify(await response.json()));
 await page.getByRole('status').filter({hasText:'Interview invitation sent. CC: '+owner.email}).waitFor();
 const submit=writes.find(item=>item.path==='/api/interview-invitations'&&item.status===200);assert.ok(submit);assert.equal(submit.status,200);
 assert.equal(submit.body.action,'interview');assert.equal(submit.body.interviewerEmail,interviewer);assert.equal(submit.body.renew,false);assert.equal(submit.body.expectedRevision,revisionBeforeSend);assert.equal(submit.body.internalNote,'Synthetic private note');assert.match(String(submit.body.previewFingerprint),/^[a-f0-9]{64}$/);
 const queued=(await f.store.tasks()).find(task=>task.id.includes(':interview:'));assert.ok(queued);assert.equal(queued.status,'done');assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].cc,[owner.email]);assert.ok(deliveries[0].body.includes(displayedUrl));assert.ok(!String(queued.payload.body).includes('Synthetic private note'));
 assert.deepEqual(queued.payload.approvedEnvelope,{sender:owner.email,to:(await f.store.applicationRow(app.id)).email,cc:[owner.email],replyTo:[interviewer]});
 const token=deliveries[0].body.match(/\/interview\/([a-f0-9]{64})/)![1];assert.ok(await f.store.stmt('SELECT 1 FROM hub_links WHERE token_hash=?',await sha256(token)).first());
 const sentLink=new URL('/api/interview-sent-link',displayedUrl);sentLink.searchParams.set('applicationId',app.id);sentLink.searchParams.set('interviewId',(await f.store.latestInterview(app.id))!.id);
 const redirect=await handlers.sentLinkGET(new Request(sentLink));assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),new URL(displayedUrl).pathname);
 const guest=await handlers.sentLinkGET(new Request(sentLink,{headers:{'x-fixture-guest':'1'}}));assert.equal(guest.status,403);
 assert.equal((await f.store.applicationRow(app.id)).stage,'Interview');
});
