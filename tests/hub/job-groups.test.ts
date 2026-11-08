import assert from "node:assert/strict";
import test from "node:test";
import { createStore, MANAGER, RECRUITER, jobInput, applicationInput } from "./fixtures";
import { changeJobGroups, jobGroupCatalog } from "../../lib/hub/job-groups";
import { handleHubRequest } from "../../lib/hub/http";
import { countryResidenceField } from "../../lib/countries";
import { matchesResidence, postingLocationCountries } from "../../lib/hiring/posting-countries";

test("role membership is explicit, versioned, and shared by role counts and applicant scope", async t=>{
  const {store,database}=createStore();t.after(()=>database.close());
  const india=await store.saveJob(jobInput()),us=await store.saveJob(jobInput());
  const a=await store.acceptApplication(applicationInput(india.id));
  await store.acceptApplication(applicationInput(us.id));
  const body={action:"save",kind:"role",name:"Engineering",jobIds:[india.id],expectedRevision:0};
  const competing = await Promise.allSettled([changeJobGroups(store,RECRUITER,body),changeJobGroups(store,MANAGER,{...body,name:"Second role"})]);
  assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
  const catalog=await jobGroupCatalog(store); const group=catalog.groups[0];
  assert.equal(catalog.revision,1); assert.deepEqual(group.jobIds,[india.id]);
  assert.deepEqual((await store.applications({jobGroupId:group.id})).items.map(row=>row.id),[a.id]);
  await assert.rejects(changeJobGroups(store,MANAGER,{...body,name:"Already in use",expectedRevision:1}),{code:"job_already_grouped"});
  await assert.rejects(changeJobGroups(store,MANAGER,{...body,id:group.id,name:"Different",jobIds:["missing"],expectedRevision:1}),{code:"job_missing"});
  const folder=await changeJobGroups(store,RECRUITER,{...body,kind:"folder",name:"Q4 hiring",jobIds:[india.id,us.id],expectedRevision:1});
  assert.equal((await store.applications({jobGroupId:folder.groups.find(g=>g.kind==="folder")!.id})).total,2);
  const changed=await changeJobGroups(store,RECRUITER,{...body,id:group.id,name:"Platform",jobIds:[us.id],expectedRevision:2});
  assert.equal(changed.groups.find(g=>g.id===group.id)!.name,"Platform");
  const url="https://jobs.example.invalid/api/hub/applications?jobGroupId="+group.id;
  assert.equal((await handleHubRequest(new Request(url+"&jobId="+us.id),["applications"],RECRUITER,store)).status,422);
  const scoped=await handleHubRequest(new Request(url),["applications"],RECRUITER,store);
  assert.equal(((await scoped.json()) as {data:{items:{jobId:string}[]}}).data.items[0].jobId,us.id);
  await changeJobGroups(store,MANAGER,{action:"delete",id:group.id,expectedRevision:3});
  assert.equal((await store.applications({jobGroupId:group.id})).total,0);
  assert.equal((await store.getJob(us.id)).formVersion,1);
});

test("authenticated HTTP create returns the saved role and GET reloads the same persisted membership", async t=>{
  const {store,database}=createStore();t.after(()=>database.close());
  const job=await store.saveJob(jobInput());
  const url="https://jobs.example.invalid/api/hub/job-groups";
  const body=JSON.stringify({action:"save",kind:"role",name:"Product",jobIds:[job.id],expectedRevision:0});
  const post=(origin:string)=>new Request(url,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body});
  assert.equal((await handleHubRequest(post("https://other.invalid"),["job-groups"],RECRUITER,store)).status,403);
  const created=await handleHubRequest(post("https://jobs.example.invalid"),["job-groups"],RECRUITER,store);
  assert.equal(created.status,200);
  const result=await created.json() as {data:{revision:number;groups:{jobIds:string[]}[]}};
  assert.equal(result.data.revision,1);
  assert.deepEqual(result.data.groups[0].jobIds,[job.id]);
  const read=await handleHubRequest(new Request(url),["job-groups"],RECRUITER,store);
  assert.equal(read.status,200);assert.deepEqual(await read.json(),result);
});

test("country search uses the job’s effective residence rules and the advertised location for unscreened jobs", async t=>{
  const {store,database}=createStore();t.after(()=>database.close());
  const form=jobInput(), field=countryResidenceField();
  const a=await store.saveJob({...form,location:"Remote · Worldwide",fields:[...form.fields,field],rules:[{enabled:true,fieldPath:field.path,operator:"in",value:["IN","PK"],reason:"Selected regions"}]});
  const b=await store.saveJob({...jobInput(),location:"Remote · Worldwide"});
  const c=await store.saveJob({...jobInput(),location:"Remote · US, Canada, UK, India"});
  const d=await store.saveJob({...jobInput(),location:"On-site · Tokyo, Japan"});
  const jobs=await store.listPublishedJobs();
  const forCountry=(country:string)=>jobs.filter(j=>matchesResidence(j,country)).map(j=>j.id).sort();
  assert.deepEqual(forCountry("IN"),[a.id,b.id,c.id].sort());
  assert.deepEqual(forCountry("PK"),[a.id,b.id].sort());
  assert.deepEqual(forCountry("JP"),[b.id,d.id].sort());
  assert.deepEqual(forCountry("GB"),[b.id,c.id].sort());
  assert.deepEqual(postingLocationCountries("Remote · Trinidad & Tobago"),["TT"]);
  assert.deepEqual(postingLocationCountries("Remote · India & Pakistan"),["IN","PK"]);
  assert.deepEqual(postingLocationCountries("On-site · Los Angeles, CA, United States"),["US"]);
  assert.deepEqual(postingLocationCountries("Remote"),[]);
});

test("the active role directory and first-review queue count the same applications", async t => {
  const {store,database}=createStore(); t.after(()=>database.close());
  const india=await store.saveJob({...jobInput(),title:"Engineer – India",location:"India"});
  const usa=await store.saveJob({...jobInput(),title:"Engineer – USA",location:"USA"});
  const retired=await store.saveJob({...jobInput(),title:"Retired engineer"});
  const paused=await store.saveJob({...jobInput(),title:"Paused posting"});
  const empty=await store.saveJob({...jobInput(),title:"Empty role"});
  const other=await store.saveJob({...jobInput(),title:"Unrelated opening"});
  const submissions=await Promise.all([india,usa,india,usa,retired,paused,other].map(j=>store.acceptApplication(applicationInput(j.id))));
  await store.stmt("UPDATE hub_applications SET stage='Screening' WHERE id=?",submissions[2].id).run();
  await store.setSetting("application_trash:"+submissions[3].id,{deletedAt:Date.now()});
  // Old/imported jobs can retain open status and an archived lifecycle record.
  await store.setSetting("job_lifecycle_"+retired.id,{state:"archived"});
  await store.stmt("UPDATE hub_jobs SET status='closed' WHERE id=?",paused.id).run();
  await store.saveJob({...jobInput(),status:"draft"});
  const role=(await changeJobGroups(store,RECRUITER,{
    action:"save",kind:"role",name:"Engineer",jobIds:[india.id,usa.id,retired.id,paused.id],expectedRevision:0,
  })).groups[0];
  await changeJobGroups(store,RECRUITER,{
    action:"save",kind:"folder",name:"Folder only",jobIds:[empty.id,other.id,india.id],expectedRevision:1,
  });
  const url="https://jobs.example.invalid/api/hub/applicant-roles";
  const directory=await handleHubRequest(new Request(url),["applicant-roles"],RECRUITER,store);
  assert.equal(directory.status,200);
  const {data:{roles}}=await directory.json() as {data:Awaited<ReturnType<typeof import("../../lib/hub/applicant-roles").applicantRoleDirectory>>};
  assert.equal(roles.length,3);
  assert.equal(roles.at(-1)?.jobId,empty.id);
  const group=roles.find(x=>x.jobGroupId===role.id)!;
  assert.deepEqual({...group,locations:group.locations.sort()},{
    jobGroupId:role.id,name:"Engineer",locations:["India","USA"],reviewCount:2,postingCount:2,
  });
  assert.equal(roles.find(x=>x.jobId===other.id)?.reviewCount,1);
  const endpoint="https://jobs.example.invalid/api/hub/applications?";
  const params=new URLSearchParams({jobGroupId:role.id,stage:"Application Review",openPostings:"true"});
  const result=await handleHubRequest(new Request(endpoint+params),["applications"],RECRUITER,store);
  const {data:queue}=await result.json() as {data:Awaited<ReturnType<typeof store.applications>>};
  assert.equal(queue.total,group.reviewCount);
  assert.equal(queue.scopeTotal,3); // both initial applications and the one in Screening
  assert.deepEqual(queue.items.map(x=>x.id).sort(),submissions.slice(0,2).map(x=>x.id).sort());
  const scope={jobGroupId:role.id,openPostings:true,stage:"Application Review"};
  assert.equal((await store.applicationNavigation(submissions[0].id,scope)).total,2);
  assert.deepEqual((await store.exportApplications(scope)).items.map(x=>x.id).sort(),queue.items.map(x=>x.id).sort());
  assert.equal((await store.applications({jobGroupId:role.id})).total,5); // explicit historical scope still works
  const anonymous=await handleHubRequest(new Request(url),["applicant-roles"],{...RECRUITER,email:""},store);
  assert.equal(anonymous.status,403);
});
