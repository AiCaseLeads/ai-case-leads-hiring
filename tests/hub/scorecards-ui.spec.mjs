import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
const id="00000000-0000-4000-8000-000000000001";
const template={id,version:1,name:"Practical exercise",createdAt:0,createdBy:"manager@example.invalid",criteria:[{label:"Correctness",weight:1,anchors:["No result","Partial","Basic","Correct","Well tested"]}]};
const job={id:"job-1",title:"Engineer",archiveCountry:"USA",hiringRound:"First"};
async function setup(t,{archived=false,mode="templates",newVersion=false,pending=false}={}){
 const catalog={revision:3,templates:[template,...(newVersion?[{...template,version:2}]:[])],archived:archived?[id]:[],bindings:{"job-1":{templateId:id,version:1}}};
 const entry=mode==="templates"?`createRoot(document.getElementById('root')).render(<ScorecardTemplates jobs={[${JSON.stringify(job)}]} />);`:`function Harness(){const draft=useScorecardDraft();const [loading,setLoading]=React.useState(false);const [revision,setRevision]=React.useState(9);return <><button onClick={()=>setLoading(true)}>Refresh detail</button>{loading?<button onClick={()=>{setRevision(v=>v+1);setLoading(false)}}>Finish detail refresh</button>:<ReusableScorecard detail={{id:'app-1',jobId:'job-1',revision}} draft={draft} saved={()=>{}}/>}</>};createRoot(document.getElementById('root')).render(<Harness/>);`;
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ScorecardTemplates,ReusableScorecard,useScorecardDraft} from './components/hub/scorecards';${entry}`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",jsx:"automatic"});
 const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":"text/html");res.end(req.url==="/bundle.js"?outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>')});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const localChrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
 const browser=await chromium.launch({headless:true,...(existsSync(localChrome)?{executablePath:localChrome}:{})});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[];
 let release=()=>{};const hold=new Promise(resolve=>{release=resolve});
 await page.route("**/api/scorecards**",async route=>{if(route.request().method()!=="GET"){writes.push(route.request().postDataJSON());if(pending)await hold;await route.fulfill({status:409,json:{error:{message:"Changed concurrently. Your draft remains."}}});}else await route.fulfill({json:{data:route.request().url().includes("jobId=")?{template,revision:3}:catalog}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole("heading",{name:mode==="templates"?"Reusable scorecards":"Reusable scorecard review",exact:true}).waitFor();
 return {page,writes,release};
}
test("archived current assignment remains visible and cannot silently unassign a batch",async t=>{
 const {page,writes}=await setup(t,{archived:true});await page.getByText("Change a scorecard on an existing job",{exact:true}).click();await page.getByLabel("Scorecard job posting").selectOption("job-1");
 assert.equal(await page.getByLabel("Reusable scorecard template").inputValue(),`${id}:1`);
 assert.equal(await page.getByRole("button",{name:"Save job scorecard",exact:true}).isDisabled(),true);
 await page.getByText("The assigned template is archived.",{exact:false}).waitFor();assert.equal(writes.length,0);
 await page.getByLabel("Reusable scorecard template").selectOption("");await page.getByRole("button",{name:"Save job scorecard",exact:true}).click();
 await page.getByText("Changed concurrently. Your draft remains.").waitFor();assert.equal(writes[0].templateId,null);
});
test("existing assignment is pinned to its displayed version until the manager explicitly selects a newer version",async t=>{
 const {page,writes}=await setup(t,{newVersion:true});await page.getByText("Change a scorecard on an existing job",{exact:true}).click();await page.getByLabel("Scorecard job posting").selectOption("job-1");assert.equal(await page.getByLabel("Reusable scorecard template").inputValue(),`${id}:1`);
 await page.getByRole("button",{name:"Save job scorecard",exact:true}).click();await page.getByText("Changed concurrently. Your draft remains.").waitFor();assert.equal(writes[0].version,1);
 await page.getByLabel("Reusable scorecard template").selectOption(`${id}:2`);await Promise.all([page.waitForResponse(r=>r.request().method()==="PATCH"),page.getByRole("button",{name:"Save job scorecard",exact:true}).click()]);assert.equal(writes[1].version,2);
});
test("review draft survives failed save, assigned-template reload and detail refresh; edits are locked during submission",async t=>{
 const {page,writes,release}=await setup(t,{mode:"review",pending:true});await page.getByLabel("Correctness: score").selectOption("4");await page.getByLabel("Correctness: supporting evidence").fill("Tested edge cases in the sample.");
 await page.getByRole("button",{name:"Save reusable scorecard",exact:true}).click();
 assert.equal(await page.getByLabel("Correctness: supporting evidence").isDisabled(),true);release();await page.getByText("Changed concurrently. Your draft remains.").waitFor();assert.equal(writes.length,1);
 await page.getByRole("button",{name:"Reload assigned scorecard",exact:true}).click();await page.getByLabel("Correctness: score").waitFor();assert.equal(await page.getByLabel("Correctness: supporting evidence").inputValue(),"Tested edge cases in the sample.");
 await page.getByRole("button",{name:"Refresh detail",exact:true}).click();await page.getByRole("button",{name:"Finish detail refresh",exact:true}).click();await page.getByLabel("Correctness: score").waitFor();assert.equal(await page.getByLabel("Correctness: score").inputValue(),"4");assert.equal(await page.getByLabel("Correctness: supporting evidence").inputValue(),"Tested edge cases in the sample.");
});

test("creating a scorecard starts with criterion names and a ready default scale, retaining the draft after a conflict",async t=>{
 const {page,writes}=await setup(t);assert.equal(await page.getByLabel("Scorecard template name").count(),0);
 await page.getByRole("button",{name:"New scorecard template",exact:true}).click();
 await page.getByLabel("Scorecard template name",{exact:true}).fill("Portfolio review");await page.getByLabel("Criterion 1 name",{exact:true}).fill("Quality of work sample");
 assert.equal(await page.getByLabel("Criterion 1: what earns 1 of 5?",{exact:true}).isVisible(),false);
 await page.getByRole("button",{name:"Save template version",exact:true}).click();await page.getByText("Changed concurrently. Your draft remains.").waitFor();
 assert.equal(writes[0].action,"save");assert.equal(writes[0].rubric.criteria[0].weight,1);assert.deepEqual(writes[0].rubric.criteria[0].anchors,["No supporting evidence","Limited supporting evidence","Meets the criterion","Strong evidence of the criterion","Exceeds the criterion with clear evidence"]);
 assert.equal(await page.getByLabel("Criterion 1 name",{exact:true}).inputValue(),"Quality of work sample");
 await page.getByText("Customize rating definitions and weight",{exact:true}).click();await page.getByLabel("Criterion 1 weight",{exact:true}).fill("2");await page.getByLabel("Criterion 1: what earns 3 of 5?",{exact:true}).fill("Work sample meets approved criteria");
 await Promise.all([page.waitForResponse(r=>r.request().method()==="PATCH"),page.getByRole("button",{name:"Save template version",exact:true}).click()]);
 assert.equal(writes[1].rubric.criteria[0].weight,2);assert.equal(writes[1].rubric.criteria[0].anchors[2],"Work sample meets approved criteria");
});
