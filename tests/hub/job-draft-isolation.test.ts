import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, MANAGER, RECRUITER, jobInput } from "./fixtures";
import { handleJobDrafts } from "../../lib/job-setup/drafts";
const state = () => ({title:"",description:"<p>Unfinished description</p>",location:null,fields:[{path:"experience",title:"",type:"Number",required:true}],department:"",customSlug:null,assessment:"",rules:[],autoReject:true,rejection:"",choice:"none",rubric:{name:"",criteria:[{label:"",weight:1,anchors:["","","","",""]}]},team:null,teamRevision:null,expectedBinding:null,step:0,creationId:crypto.randomUUID(),postingLabel:"Private work in progress",formVersion:null,startKind:"blank",sourceId:""});
const req=(method:string,body?:unknown,key?:string,origin="https://jobs.example.invalid")=>new Request("https://jobs.example.invalid/api/job-drafts"+(key?"?key="+encodeURIComponent(key):""),{method,headers:{Origin:origin,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
test("private recovery saves incomplete data without publishing or changing an existing open job",async()=>{
 const {store}=createStore();const original=await store.saveJob({...jobInput(),status:"open"});
 const response=await handleJobDrafts(req("PUT",{key:original.id,expectedRevision:0,state:state()}),MANAGER,store);assert.equal(response.status,200);const saved=(await response.json()).data;
 assert.equal(saved.state.title,"");assert.equal(saved.state.fields[0].title,"");assert.equal(saved.state.location,null);assert.equal(saved.revision,1);
 assert.deepEqual(await store.getJob(original.id),original);assert.equal((await store.listJobs()).length,1);
});
test("a recruiter cannot read, overwrite, delete or list another staff member's saved recovery",async()=>{
 const {store}=createStore();const key="new:blank:";const privateState=state();privateState.title="Manager private draft";
 assert.equal((await handleJobDrafts(req("PUT",{key,expectedRevision:0,state:privateState}),MANAGER,store)).status,200);
 assert.equal((await (await handleJobDrafts(req("GET",undefined,key),RECRUITER,store)).json()).data,null);
 assert.deepEqual((await (await handleJobDrafts(req("GET"),RECRUITER,store)).json()).data,[]);
 assert.equal((await handleJobDrafts(req("DELETE",{key,expectedRevision:0}),RECRUITER,store)).status,200);
 assert.equal((await handleJobDrafts(req("PUT",{key,expectedRevision:0,state:state()}),RECRUITER,store)).status,200);
 assert.equal((await (await handleJobDrafts(req("GET",undefined,key),MANAGER,store)).json()).data.state.title,"Manager private draft");
});
test("anonymous and cross-origin draft operations are refused without writing recovery records",async()=>{
 const {store}=createStore();const body={key:"new:blank:",expectedRevision:0,state:state()};
 for(const method of ["GET","PUT","DELETE"])assert.equal((await handleJobDrafts(req(method,method==="GET"?undefined:body),null,store)).status,403);
 for(const method of ["PUT","DELETE"])assert.equal((await handleJobDrafts(req(method,body,undefined,"https://attacker.example.invalid"),MANAGER,store)).status,403);
 assert.deepEqual((await (await handleJobDrafts(req("GET"),MANAGER,store)).json()).data,[]);
});
test("stale tab saves and deletes cannot destroy a newer recovery revision",async()=>{
 const {store}=createStore(),key="new:blank:";
 assert.equal((await handleJobDrafts(req("PUT",{key,expectedRevision:0,state:state()}),MANAGER,store)).status,200);
 const fresh={...state(),title:"Latest saved entries"};assert.equal((await handleJobDrafts(req("PUT",{key,expectedRevision:1,state:fresh}),MANAGER,store)).status,200);
 assert.equal((await handleJobDrafts(req("PUT",{key,expectedRevision:1,state:state()}),MANAGER,store)).status,409);
 assert.equal((await handleJobDrafts(req("DELETE",{key,expectedRevision:1}),MANAGER,store)).status,409);
 const retained=(await(await handleJobDrafts(req("GET",undefined,key),MANAGER,store)).json()).data;assert.equal(retained.revision,2);assert.equal(retained.state.title,fresh.title);
 assert.equal((await handleJobDrafts(req("DELETE",{key,expectedRevision:2}),MANAGER,store)).status,200);assert.equal((await(await handleJobDrafts(req("GET",undefined,key),MANAGER,store)).json()).data,null);
});
