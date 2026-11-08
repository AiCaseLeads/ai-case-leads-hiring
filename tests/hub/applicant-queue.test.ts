import assert from "node:assert/strict";
import test from "node:test";
import { createStore,jobInput,applicationInput,MANAGER,RECRUITER } from "./fixtures";
import { createApplicationSelection,getApplicationSelection } from "../../lib/hub/application-selections";
import { handleHubRequest } from "../../lib/hub/http";

test("a cross-role selection freezes applications, rechecks membership, preserves templates and counts distinct recipients",async()=>{
 const {store,database}=createStore();
 try {
  const one=await store.saveJob({...jobInput(),title:"Role One",rejectionTemplate:"One-team decision for {{jobTitle}}."});
  const two=await store.saveJob({...jobInput(),title:"Role Two",rejectionTemplate:"Two-team decision for {{jobTitle}}."});
  const a=await store.acceptApplication(applicationInput(one.id)),b=await store.acceptApplication(applicationInput(two.id));
  database.prepare("UPDATE hub_applications SET email='same@example.invalid'").run();
  const selection=await createApplicationSelection(store,{},MANAGER);
  const ids=await getApplicationSelection(store,selection.selectionId,MANAGER);
  assert.deepEqual(ids.toSorted(),[a.id,b.id].toSorted());
  await assert.rejects(getApplicationSelection(store,selection.selectionId,RECRUITER),{code:"selection_unavailable"});
  const c=await store.acceptApplication(applicationInput(two.id));
  await assert.rejects(store.previewBulkRejection({jobId:one.id},ids,"Decision",MANAGER),{code:"bulk_selection_changed"});
  const plan=await store.previewBulkRejection({},ids,"Decision",MANAGER);
  assert.equal(plan.count,2);assert.equal(plan.recipients,1);assert.equal(plan.excluded,0);
  await store.executeBulkRejection(plan.planId,MANAGER);
  assert.equal((await store.applicationRow(c.id)).stage,"Application Review");
  const tasks=(await store.tasks()).filter(t=>t.id.includes(':rejection:'));
  assert.deepEqual(tasks.map(t=>t.applicationId).toSorted(),[a.id,b.id].toSorted());
  assert.match(String(tasks.find(t=>t.applicationId===a.id)?.payload.body),/One-team decision/);
  assert.match(String(tasks.find(t=>t.applicationId===b.id)?.payload.body),/Two-team decision/);
 } finally {database.close();}
});

test("residence filters and unfiltered scope totals include new and historical written country fields",async()=>{
 const {store,database}=createStore();
 try{
  const job=await store.saveJob(jobInput());
  const a=await store.acceptApplication(applicationInput(job.id)),b=await store.acceptApplication(applicationInput(job.id)),c=await store.acceptApplication(applicationInput(job.id));
  database.prepare("UPDATE hub_applications SET answers_json=? WHERE id=?").run(JSON.stringify([{path:"country_of_residence",value:"IN"}]),a.id);
  database.prepare("UPDATE hub_applications SET fields_json=?, answers_json=? WHERE id=?").run(JSON.stringify([{path:"custom",title:"What country do you currently live in?",type:"String"}]),JSON.stringify([{path:"custom",value:"Pakistan"}]),b.id);
  database.prepare("UPDATE hub_applications SET answers_json=? WHERE id=?").run(JSON.stringify([{path:"unrelated",value:"India"}]),c.id);
  const broken=await store.acceptApplication(applicationInput(job.id));
  database.prepare("UPDATE hub_applications SET answers_json='invalid',fields_json='invalid' WHERE id=?").run(broken.id);
  const mixed=await store.acceptApplication(applicationInput(job.id));
  database.prepare("UPDATE hub_applications SET answers_json=?,fields_json=? WHERE id=?").run(JSON.stringify([null,17,"not-json",{path:"misc",value:"Pakistan"}]),JSON.stringify([null,"not-json",17]),mixed.id);
  const response=await handleHubRequest(new Request("https://jobs.example.invalid/api/hub/applications?country=IN,PK&stage=Application+Review"),["applications"],MANAGER,store);
  assert.equal(response.status,200);
  const result=await response.json() as {data:{items:{id:string}[];total:number;scopeTotal:number}};
  assert.deepEqual(result.data.items.map(r=>r.id).toSorted(),[a.id,b.id].toSorted());
  assert.equal(result.data.total,2);assert.equal(result.data.scopeTotal,5);
  await assert.rejects(store.applications({country:"XX"}),{code:"invalid_country"});
 } finally{database.close();}
});
