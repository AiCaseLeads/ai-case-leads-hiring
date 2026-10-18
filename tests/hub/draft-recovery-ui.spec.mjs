import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
const prior={id:"existing-job",title:"Creative Strategist",slug:"creative-strategist",department:"Creative",location:"Remote — Spain",status:"open",descriptionHtml:"Approved role description",fields:[{path:"_systemfield_name",title:"Full name",type:"String",required:true},{path:"_systemfield_email",title:"Email",type:"Email",required:true}],rules:[],autoReject:false,rejectionTemplate:"Thank you",assessmentPrompt:"",formVersion:3,archiveProject:"Creative Strategist",archiveCountry:"Spain",hiringRound:"Previous round"};
const member={email:"owner@example.invalid",role:"admin"};
const emptyCatalog={revision:0,templates:[],requests:[],locations:{"existing-job":{workModel:"remote",country:"Spain",city:""}}};
async function setup(t,{jobs=[prior],failDraft=false,failLoad=false,mobile=false}={}){
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';import{HUB_HISTORY_GUARD}from'./components/hub/history';(0,eval)(HUB_HISTORY_GUARD);createRoot(document.getElementById('root')).render(<HiringDashboard member={${JSON.stringify(member)}} signOutHref="/logout"/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",jsx:"automatic"});
 const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":"text/html");res.end(req.url==="/bundle.js"?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});page.setDefaultTimeout(5000);
 const writes=[],draftWrites=[],drafts=new Map(),errors=[];page.on("pageerror",error=>errors.push(error.message));
 let failing=failDraft,loadFailure=failLoad;
 await page.route("**/api/**",async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;let data={};
 if(path==="/api/job-drafts"){
  if(req.method()==="GET"){if(loadFailure)return route.fulfill({status:503,json:{error:{message:"Draft read unavailable"}}});data=url.searchParams.has("key")?(drafts.get(url.searchParams.get("key"))||null):[...drafts.values()].map(({key,revision,updatedAt,state})=>({key,revision,updatedAt,title:state.title,startKind:state.startKind,sourceId:state.sourceId}));}
  else{const input=req.postDataJSON();draftWrites.push({method:req.method(),...input});if(failing)return route.fulfill({status:503,json:{error:{message:"Draft storage temporarily unavailable"}}});if(req.method()==="DELETE"){drafts.delete(input.key);data={deleted:true};}else{data={key:input.key,revision:(drafts.get(input.key)?.revision||0)+1,updatedAt:Date.now(),state:input.state};drafts.set(input.key,data);}}
 }else if(path==="/api/hub/jobs")data=jobs;
 else if(path==="/api/job-setup"){
  if(req.method()==="GET")data=emptyCatalog;
  else{const input=req.postDataJSON();writes.push(input);data={...input.job,id:input.jobId||input.creationId,formVersion:4};}
 }else if(path==="/api/scorecards")data={revision:0,templates:[],archived:[],bindings:{}};
 else if(path==="/api/job-team")data={config:null,staff:[member],sender:member.email};
 else if(path==="/api/hub/overview")data={counts:{applications:0,active:0,rejected:0,hired:0},stageCounts:[],recentApplications:[],integrations:{google:true,drive:true,applicationsEnabled:true},jobs};
 else if(path==="/api/review-reminders")data={total:0,staff:[],config:{dueHours:48,enabled:false,fallbackAdmins:[]},applications:[]};
 else if(path==="/api/hub/tasks")data=[];
 await route.fulfill({json:{data}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/?view=jobs`);await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();
 return {page,writes,draftWrites,drafts,errors,setFail:value=>{failing=value;},setLoadFail:value=>{loadFailure=value;}};
}
async function blank(page){await page.getByRole("button",{name:"Create job",exact:true}).click();await page.getByRole("button",{name:"Create blank job",exact:true}).click();await page.getByLabel("Job title",{exact:true}).waitFor();}
async function next(page){await page.getByRole("button",{name:"Continue",exact:true}).click();}
test("cancel and sidebar navigation warn on unsaved edits; keep editing preserves text",async t=>{
 const {page,writes}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Private unfinished job");
 await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Keep editing",exact:true}).waitFor();
 await page.getByRole("button",{name:"Keep editing",exact:true}).click();assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Private unfinished job");
 await page.getByRole("navigation",{name:"Hiring workspace"}).getByRole("button",{name:"Home",exact:true}).click();await page.getByRole("button",{name:"Keep editing",exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get("view"),"jobs");await page.getByRole("button",{name:"Keep editing",exact:true}).click();assert.equal(writes.length,0);
});
test("wizard Back and browser Back between steps retain entries without a leave prompt",async t=>{
 const {page}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Draft with safe step navigation");await next(page);
 await page.getByRole("button",{name:"Back",exact:true}).click();assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Draft with safe step navigation");assert.equal(await page.getByRole("button",{name:"Keep editing",exact:true}).count(),0);
 await next(page);await page.goBack();await page.getByLabel("Job title",{exact:true}).waitFor();assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Draft with safe step navigation");assert.equal(await page.getByRole("button",{name:"Keep editing",exact:true}).count(),0);
});
test("failed Save draft & leave remains in editor with data and guard intact",async t=>{
 const {page,writes,setFail}=await setup(t,{failDraft:true});await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Unsaved during outage");await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Save draft & leave",exact:true}).click();await page.getByRole("dialog").getByText("Draft storage temporarily unavailable",{exact:false}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get("view"),"jobs");assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Unsaved during outage");assert.equal(writes.length,0);
 await page.getByRole("button",{name:"Keep editing",exact:true}).click();await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Save draft & leave",exact:true}).waitFor();setFail(false);await page.getByRole("button",{name:"Save draft & leave",exact:true}).click();await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();
});
test("60-second autosave preserves partial edits separately from a published posting",async t=>{
 const {page,writes,draftWrites,drafts,errors}=await setup(t);await page.clock.install();await page.getByRole("button",{name:"Edit job",exact:true}).click();await page.getByLabel("Job title",{exact:true}).fill("");
 await page.clock.fastForward(59000);assert.equal(draftWrites.filter(x=>x.method==="PUT").length,0);const saved=page.waitForResponse(r=>r.url().includes("/api/job-drafts")&&r.request().method()==="PUT");await page.clock.fastForward(2000);await saved;
 assert.equal(draftWrites.filter(x=>x.method==="PUT").length,1);assert.equal(writes.length,0);assert.equal([...drafts.values()][0].state.title,"");assert.equal(prior.status,"open");assert.deepEqual(errors,[]);
});
test("browser Back leaving Details is guarded and Keep editing restores the editor URL",async t=>{
 const {page}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Keep me on Back");const original=page.url();await page.goBack();await page.getByRole("button",{name:"Keep editing",exact:true}).waitFor();await page.getByRole("button",{name:"Keep editing",exact:true}).click();assert.equal(page.url(),original);assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Keep me on Back");
});
test("partial private draft restores on reload and explicit job save clears its recovery copy",async t=>{
 const {page,drafts,writes}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Recovered job title");await page.getByRole("textbox",{name:"Job description",exact:true}).fill("<literal> details with unfinished formatting");await page.getByRole("button",{name:"Save progress now",exact:true}).click();await page.getByText(/Draft saved at/).waitFor();assert.equal(drafts.size,1);assert.equal(writes.length,0);
 await page.reload();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Recovered job title");assert.equal(await page.getByRole("textbox",{name:"Job description",exact:true}).innerText(),"<literal> details with unfinished formatting");
 await page.getByRole("button",{name:"Save draft job",exact:true}).click();await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();assert.equal(drafts.size,0);assert.equal(writes.length,1);assert.equal(writes[0].job.status,"draft");
});
test("discarded session cannot return with an unguarded dirty editor through browser Back",async t=>{
 const {page}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Discard me");await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Leave without saving",exact:true}).click();await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();await page.goBack();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const title=page.getByLabel("Job title",{exact:true});await page.waitForFunction(()=>{const el=document.querySelector("#jobs-title");return !el || new URL(location.href).searchParams.get("jobEditor")===null || el.closest("section").hidden;});if(new URL(page.url()).searchParams.has("jobEditor")){await title.waitFor();
  await title.fill("A new unsaved edit after returning");await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Keep editing",exact:true}).waitFor();
 }
});
test("unfinished numeric screening survives save/reload without enabling automatic decisions",async t=>{
 const job={...prior,fields:[...prior.fields,{path:"years",title:"Years of experience",type:"Number",required:true}]};const {page,drafts,writes}=await setup(t,{jobs:[job]});await page.getByRole("button",{name:"Edit job",exact:true}).click();await next(page);await page.getByRole("region",{name:"Screening for Years of experience",exact:true}).getByRole("checkbox",{name:"Set a qualifying answer",exact:true}).check();await page.getByLabel("Minimum accepted number for Years of experience",{exact:true}).fill("");await page.getByRole("button",{name:"Save progress now",exact:true}).click();await page.getByText(/Draft saved at/).waitFor();assert.equal(drafts.size,1);assert.equal(writes.length,0);await page.reload();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await page.getByLabel("Minimum accepted number for Years of experience",{exact:true}).inputValue(),"");assert.equal(await page.getByRole("checkbox",{name:"Automatically reject applicants who fail enabled requirements",exact:true}).isChecked(),false);
});
test("Save draft & leave returns through Resume draft and a failed initial load can retry",async t=>{
 const {page,setLoadFail,writes}=await setup(t,{failLoad:true});await blank(page);await page.getByRole("button",{name:"Retry loading draft",exact:true}).waitFor();assert.equal(await page.getByLabel("Job title",{exact:true}).isDisabled(),true);setLoadFail(false);await page.getByRole("button",{name:"Retry loading draft",exact:true}).click();await page.getByLabel("Job title",{exact:true}).fill("Resume this later");await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Save draft & leave",exact:true}).click();await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();await page.getByRole("button",{name:"Resume draft",exact:true}).click();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"Resume this later");assert.equal(writes.length,0);
});
test("blocked browser Back preserves history for another Back and Forward after keep-editing",async t=>{
 const {page}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("History recovery");const url=page.url();await page.goBack();await page.getByRole("button",{name:"Keep editing",exact:true}).click();assert.equal(page.url(),url);await page.goBack();await page.getByRole("button",{name:"Save draft & leave",exact:true}).click();await page.getByRole("button",{name:"Create blank job",exact:true}).waitFor();await page.goForward();await page.getByText(/Saved draft restored/).waitFor();assert.equal(await page.getByLabel("Job title",{exact:true}).inputValue(),"History recovery");
});
test("refresh or external navigation warns until current entries have been saved",async t=>{
 const {page}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Dirty before refresh");const prevented=()=>page.evaluate(()=>{const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});assert.equal(await prevented(),true);await page.getByRole("button",{name:"Save progress now",exact:true}).click();await page.getByText(/Draft saved at/).waitFor();assert.equal(await prevented(),false);await page.getByLabel("Job title",{exact:true}).fill("Dirty again");assert.equal(await prevented(),true);
});
test("discarding a resumed draft through browser Back removes its saved-progress row immediately",async t=>{
 const {page,drafts,writes}=await setup(t);await blank(page);await page.getByLabel("Job title",{exact:true}).fill("Discard resumed private progress");await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Save draft & leave",exact:true}).click();await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();await page.getByRole("button",{name:"Resume draft",exact:true}).click();await page.getByText(/Saved draft restored/).waitFor();assert.equal(drafts.size,1);
 await page.goBack();await page.getByRole("button",{name:"Leave without saving",exact:true}).click();await page.getByRole("heading",{name:"Jobs",exact:true}).waitFor();assert.equal(drafts.size,0,"server recovery was deleted");await page.getByRole("button",{name:"Resume draft",exact:true}).waitFor({state:"hidden"});assert.equal(await page.getByText("Discard resumed private progress",{exact:true}).count(),0,"deleted draft must not remain listed");assert.equal(writes.length,0);
});

test('restored private draft allows direct section jumps while invalid publication remains blocked',async t=>{
 const{page,writes,drafts}=await setup(t,{jobs:[]});await blank(page);await page.getByLabel('Job title',{exact:true}).fill('Recoverable draft');await page.getByRole('button',{name:'Save progress now',exact:true}).click();await page.getByText(/Draft saved at/).waitFor();assert.equal(drafts.size,1);
 await page.reload();await page.getByText(/Saved draft restored/).waitFor();await page.getByLabel('Job title',{exact:true}).waitFor();const steps=page.getByRole('list',{name:'Job setup progress'});await steps.getByRole('button',{name:'Review settings',exact:true}).click();await steps.getByRole('button',{name:'Application questions',exact:true}).click();await steps.getByRole('button',{name:'Job details',exact:true}).click();await page.getByLabel('Job title',{exact:true}).fill('');await steps.getByRole('button',{name:'Preview & publish',exact:true}).click();await page.getByRole('button',{name:'Publish job',exact:true}).click();await page.getByText('Add a job title, then choose a work arrangement and location.',{exact:false}).waitFor();assert.equal(writes.length,0);
});
