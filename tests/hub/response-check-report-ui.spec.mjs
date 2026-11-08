import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";
import {tsImport} from "tsx/esm/api";

const {createStore,jobInput,applicationInput,MANAGER}=await tsImport("./fixtures.ts",import.meta.url);
const {handleHubRequest}=await tsImport("../../lib/hub/http.ts",import.meta.url);
test("staff review full original answers, timing and per-answer estimates on phones and desktop",async t=>{
  const {store,database}=createStore();
  const base=jobInput();
  const job=await store.saveJob({...base,fields:[...base.fields,{path:"case_sample",title:"Describe an example",type:"LongText",required:false}]});
  const answer="I traced the duplicate event back to a second tag, compared logs, and validated the fix.";
  const ids=[];
  for(let n=0;n<22;n++){
    const input=applicationInput(job.id);
    input.fieldSubmissions[0].value="Synthetic Candidate "+n;
    input.fieldSubmissions.push({path:"case_sample",value:answer});
    const {id}=await store.acceptApplication(input);ids.push(id);
    await store.stmt("UPDATE hub_applications SET created_at=? WHERE id=?",n,id).run();
  }
  const id=ids.at(-1);
  await store.stmt("INSERT INTO hub_response_index(application_id,indexed_at) VALUES(?,1)",id).run();
  await store.stmt("INSERT INTO hub_response_detector_cache(answer_hash,status,classification,confidence,updated_at) VALUES(?, 'ready','MIXED','medium',1)","test-hash").run();
  await store.stmt("INSERT INTO hub_response_answers(application_id,path,title,words,answer_hash) VALUES(?,?,?,?,?)",id,"case_sample","Describe an example",16,"test-hash").run();
  await store.stmt("UPDATE hub_applications SET response_entry_json=? WHERE id=?",JSON.stringify({version:1,formElapsedMs:9330,firstEditToSubmitMs:2500,fields:[{path:"case_sample",pasteAttempts:2,largeInsertions:0,largestInsertionChars:0}]}),id).run();
  const peer=ids.at(-2);
  await store.stmt("INSERT INTO hub_response_index(application_id,indexed_at) VALUES(?,1)",peer).run();
  for (const application of [id,peer]) await store.stmt("INSERT INTO hub_response_passages(application_id,path,passage_hash,excerpt) VALUES(?,'case_sample','same','a common passage of sufficient length')",application).run();
  const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ResponseCheckReport}from'./components/hub/response-checks';createRoot(document.querySelector('main')).render(<ResponseCheckReport isOwner={location.search.includes('owner')} refresh={0}/>);`,loader:"tsx"},bundle:true,write:false,jsx:"automatic",format:"iife"});
  const css=["hub.css","workspace-v3.css","workspace-surfaces.css"].map(f=>readFileSync("components/hub/"+f,"utf8")).join("\n");
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,"http://"+req.headers.host);
      if(url.pathname==="/bundle.js"){res.setHeader("Content-Type","text/javascript");res.end(outputFiles[0].text);return;}
      if(url.pathname.startsWith("/api/hub/")){
        const reply=await handleHubRequest(new Request(url),url.pathname.slice(9).split("/"),MANAGER,store);
        res.writeHead(reply.status,{"Content-Type":"application/json"});res.end(await reply.text());return;
      }
      res.setHeader("Content-Type","text/html");
      res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:8px}'+css+'</style><main class="hiring-hub"></main><script src="/bundle.js"></script>');
    }catch{res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});database.close();});
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  for(const width of [320,1280]){
    const page=await browser.newPage({viewport:{width,height:800},hasTouch:width===320});
    page.setDefaultTimeout(5000);
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:"+server.address().port+(width===320?"":"?owner"));
    await page.getByText("22 matching applications").waitFor();
    assert.equal(await page.getByText("GPTZero connection",{exact:true}).count(),width===320?0:1);
    await page.getByText("Synthetic Candidate 21",{exact:true}).click();
    await page.getByText(answer,{exact:true}).waitFor();
    await page.getByText("Form open to submission: 9 sec",{exact:true}).waitFor();
    await page.getByText(/Reported paste attempts.*2/).waitFor();
    await page.getByText(/Resembles mixed-source text/).waitFor();
    assert.equal(await page.getByRole("link",{name:"Open applicant profile"}).getAttribute("href"),"/team?view=applications&application="+id);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.getByRole("button",{name:"Next",exact:true}).click();
    await page.getByText("Page 2 of 2",{exact:true}).waitFor();
    await page.getByText("Synthetic Candidate 0",{exact:true}).click();
    await page.getByText(answer,{exact:true}).waitFor();
    await page.getByText("Form timing unavailable",{exact:true}).waitFor();
    await page.getByText(/GPTZero estimate · Too short to assess/).waitFor();
    await page.getByLabel("Processing status").selectOption("ready");
    await page.getByText("1 matching application",{exact:true}).waitFor();
    assert.equal(await page.locator(".response-check-app").count(),1);
    await page.getByLabel("Processing status").selectOption("");
    await page.getByLabel("Matching passages only").check();
    await page.getByText("2 matching applications").waitFor();
    await page.getByText("Synthetic Candidate 21",{exact:true}).click();
    await page.getByText("Matching passages (1)",{exact:true}).click();
    await page.getByText("a common passage of sufficient length").waitFor();
    assert.deepEqual(errors,[]);
    await page.close();
  }
});
