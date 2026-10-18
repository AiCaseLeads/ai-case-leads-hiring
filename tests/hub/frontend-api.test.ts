import assert from "node:assert/strict";
import { test } from "node:test";
import { handleHubRequest } from "../../lib/hub/http";
import { createStore, jobInput, applicationInput, currentAction, MANAGER } from "./fixtures";

function request(path: string, body?: unknown, method = "POST") {
  return new Request("https://jobs.example.invalid/api/hub/" + path, body === undefined ? {} : {method,headers:{Origin:"https://jobs.example.invalid","Content-Type":"application/json"},body:JSON.stringify(body)});
}
test("dashboard APIs compare grades only for one role and export the same filtered applications", async () => {
  const {store,database}=createStore();
  try {
    const job=await store.saveJob(jobInput()), first=await store.acceptApplication(applicationInput(job.id)), second=await store.acceptApplication(applicationInput(job.id));
    await currentAction(store,first.id,{action:"scorecard",score:2,criteria:"Approved rubric",text:"Observed evidence"},MANAGER);
    await currentAction(store,second.id,{action:"scorecard",score:5,criteria:"Approved rubric",text:"Observed evidence"},MANAGER);
    assert.equal((await handleHubRequest(request("applications?sort=grade_desc"),["applications"],MANAGER,store)).status,422);
    const query=`jobId=${job.id}&sort=grade_desc&grade=reviewed&qualification=review`;
    const response=await handleHubRequest(request("applications?"+query),["applications"],MANAGER,store);
    assert.equal(response.status,200);
    const body=await response.json() as {data:{items:{id:string;revision:number;grade:{averageScore:number}}[]}};
    assert.deepEqual(body.data.items.map((app)=>app.id),[second.id,first.id]);
    assert.equal(body.data.items[0].grade.averageScore,5);assert.ok(body.data.items[0].revision);
    const exported=await handleHubRequest(request("applications-export?"+query),["applications-export"],MANAGER,store);
    const data=(await exported.json() as {data:{items:{id:string}[];limit:number;truncated:boolean}}).data;
    assert.deepEqual(data.items.map((app)=>app.id),body.data.items.map((app)=>app.id));
    assert.equal(data.limit,10000);assert.equal(data.truncated,false);
  } finally {database.close();}
});

test("dashboard writes reject missing revisions and stale settings without discarding persisted values", async()=>{
  const {store,database}=createStore();
  try {
    const job=await store.saveJob(jobInput()), {id}=await store.acceptApplication(applicationInput(job.id));
    assert.equal((await handleHubRequest(request(`applications/${id}/action`,{action:"note",text:"Missing revision"}),["applications",id,"action"],MANAGER,store)).status,422);
    const settings=await store.settings();
    assert.equal((await handleHubRequest(request("settings",{settingsVersion:settings.settingsVersion,rejectionTemplate:"Approved default"},"PATCH"),["settings"],MANAGER,store)).status,200);
    assert.equal((await handleHubRequest(request("settings",{settingsVersion:settings.settingsVersion,rejectionTemplate:"Stale override"},"PATCH"),["settings"],MANAGER,store)).status,409);
    assert.equal((await store.settings()).templates.rejection,"Approved default");
  } finally {database.close();}
});
