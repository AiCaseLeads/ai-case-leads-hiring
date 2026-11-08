import assert from "node:assert/strict";
import test from "node:test";
import { handleHubRequest } from "../../lib/hub/http";
import { applicantCollections } from "../../lib/hub/applicant-collections";
import type { HubMember } from "../../lib/hub/auth-core";
import { applicationInput, createStore, jobInput, MANAGER, RECRUITER } from "./fixtures";

async function data<T>(response:Response):Promise<T>{
  assert.equal(response.status,200);
  return (await response.json() as {data:T}).data;
}

async function setup(){
  const {database,store}=createStore();
  const role1=await store.saveJob({...jobInput(),slug:'marketing-us',title:'Marketing USA'});
  const role2=await store.saveJob({...jobInput(),slug:'marketing-br',title:'Marketing Brazil'});
  const a=(await store.acceptApplication(applicationInput(role1.id))).id;
  const b=(await store.acceptApplication(applicationInput(role2.id))).id;
  const c=(await store.acceptApplication(applicationInput(role2.id))).id;
  const origin="https://jobs.example.invalid";
  function api(path:string, member:HubMember, body?:unknown) {
    const url=new URL('/api/hub/'+path,origin);
    const req = new Request(url,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})});
    return handleHubRequest(req,url.pathname.slice('/api/hub/'.length).split('/'),member,store);
  }
  async function create(body:Record<string,unknown>) {
    const res=await api('collections',MANAGER,{action:'create',...body});
    assert.equal(res.status,200);
    return (await data<{id:string}>(res)).id;
  }
  async function apps(list:string, member=MANAGER as HubMember){
    const res=await api('applications?listId='+list+'&active=false',member);
    assert.equal(res.status,200);
    return data<{total:number;items:{id:string}[]}>(res);
  }
  return {database,store,a,b,c,api,create,apps};
}

test('handpicked cross-role applications stay in the list after a stage change, share internally, and never enter a private user’s selection',async t=>{
  const f=await setup();t.after(()=>f.database.close());
  const privateId=await f.create({kind:"list",name:"Private",visibility:"personal",ids:[f.a,f.b]});
  const teamId=await f.create({kind:"list",name:"Founder finalists",visibility:"team",ids:[f.b,f.c]});
  assert.deepEqual((await applicantCollections(f.store,RECRUITER)).map(r=>r.id),[teamId]);
  assert.equal((await f.apps(privateId,RECRUITER)).total,0);
  const spoofed=await f.api('applications?listId='+privateId+'&listViewer='+encodeURIComponent(MANAGER.email),RECRUITER);
  assert.equal((await data<{total:number}>(spoofed)).total,0);
  assert.equal((await f.store.exportIds({listId:privateId,listViewer:RECRUITER.email})).length,0);
  const nav=await f.api('applications/'+f.a+'/navigation?listId='+privateId,RECRUITER);
  const navigation=await data<{total:number;nextId:string|null}>(nav);
  assert.equal(navigation.total,0);assert.equal(navigation.nextId,null);
  f.database.prepare("UPDATE hub_applications SET stage='Rejected' WHERE id=?").run(f.b);
  assert.deepEqual((await f.apps(teamId,RECRUITER)).items.map(r=>r.id).sort(),[f.b,f.c].sort());
  const compare=await f.api('collections?listId='+teamId+'&compare='+f.c+'&compare='+f.b,RECRUITER);
  const rows=await data<{id:string;stage:string}[]>(compare);
  assert.equal(rows[0].id,f.c);
  assert.equal(rows[1].stage,'Rejected');
  assert.equal('email' in rows[0],false);
  assert.equal((await f.api('collections?listId='+privateId+'&compare='+f.a+'&compare='+f.b,RECRUITER)).status,404);
  assert.equal((await f.api('collections',RECRUITER,{action:'delete',id:teamId,revision:1})).status,403);
  assert.equal((await f.api('collections',RECRUITER,{action:'add',id:teamId,revision:1,ids:[f.a]})).status,200);
  assert.equal((await f.apps(teamId,RECRUITER)).total,3);
  assert.equal((await f.api('collections',RECRUITER,{action:'remove',id:teamId,revision:2,ids:[f.a]})).status,200);
  assert.equal((await f.apps(teamId)).total,2);
  assert.equal((await f.api('collections',MANAGER,{action:'delete',id:teamId,revision:3})).status,200);
  assert.equal(f.database.prepare('SELECT count(*) AS n FROM hub_collection_members WHERE collection_id=?').get(teamId)!.n,0);
  assert.ok(await f.store.getApplication(f.a));
});
test('collection edits are revision-guarded atomically and never save a partial selection',async t=>{
  const f=await setup();t.after(()=>f.database.close());
  const creation={kind:'list',name:'First',visibility:'team',creationId:crypto.randomUUID(),ids:[f.a]};
  const id=await f.create(creation);
  assert.equal(await f.create(creation),id);
  assert.equal((await applicantCollections(f.store,RECRUITER)).length,1);
  assert.equal((await f.api('collections',MANAGER,{action:'add',id,revision:1,ids:[f.b,'missing']})).status,409);
  assert.equal((await f.apps(id)).total,1);
  const edits=await Promise.all([f.api('collections',RECRUITER,{action:'add',id,revision:1,ids:[f.b]}),f.api('collections',MANAGER,{action:'add',id,revision:1,ids:[f.c]})]);
  assert.deepEqual(edits.map(x=>x.status).sort(),[200,409]);
  assert.equal((await f.apps(id)).total,2);
  const res=await f.api('collections',RECRUITER,{action:'create',kind:'list',visibility:'personal',name:'Bad',ids:[f.b,'missing']});
  assert.equal(res.status,409);
  assert.equal((await applicantCollections(f.store,RECRUITER)).length,1);
  const forged=new Request('https://jobs.test/api/hub/collections',{method:'POST',headers:{Origin:'https://elsewhere.invalid'},body:'{}'});
  assert.equal((await handleHubRequest(forged,['collections'],MANAGER,f.store)).status,403);
});
test('saved views apply fresh filters and cannot widen a personal list when shared',async t=>{
  const f=await setup();t.after(()=>f.database.close());
  const list=await f.create({kind:'list',name:'Private',visibility:'personal',ids:[f.a]});
  assert.equal((await f.api('collections',MANAGER,{action:'create',kind:'view',name:'Oops',visibility:'team',query:'listId='+list})).status,422);
  assert.equal((await f.api('collections',MANAGER,{action:'create',kind:'view',name:'Bad',visibility:'team',query:'stage=unknown'})).status,422);
  const id=await f.create({kind:'view',name:'Founder decisions',visibility:'team',query:new URLSearchParams({stage:'Awaiting Founder Review',sort:'newest'}).toString()});
  const saved=(await applicantCollections(f.store,RECRUITER))[0]; assert.equal(saved.id,id);
  const open=async()=> (await data<{total:number}>(await f.api('applications?'+saved.query,RECRUITER))).total;
  assert.equal(await open(),0);
  f.database.prepare("UPDATE hub_applications SET stage='Awaiting Founder Review' WHERE id=?").run(f.b);
  assert.equal(await open(),1);
  const deepLink=await f.api('collections/'+id+'/open',RECRUITER);
  assert.equal(deepLink.status,302);
  assert.equal(new URL(deepLink.headers.get('location')!,'https://jobs.example.invalid').searchParams.get('stage'),'Awaiting Founder Review');
  assert.equal((await f.api('collections',MANAGER,{action:'edit',id,revision:1,name:'Decisions',visibility:'personal'})).status,200);
  assert.deepEqual(await applicantCollections(f.store,RECRUITER),[]);
  assert.equal((await f.api('collections/'+id+'/open',RECRUITER)).status,404);
});

test('saved list order is stable across review navigation, exports, duplicate additions, and multi-select ranking', async t=>{
  const f=await setup();t.after(()=>f.database.close());
  const id=await f.create({kind:'list',name:'Priority order',visibility:'team',ids:[f.b,f.a,f.c]});
  const filters={listId:id,listViewer:RECRUITER.email,sort:'list_order' as const};
  assert.deepEqual(await f.store.exportIds(filters),[f.b,f.a,f.c]);
  assert.equal((await f.api('collections',RECRUITER,{action:'prioritize',id,revision:1,ids:[f.c,f.a]})).status,200);
  const expected=[f.c,f.a,f.b];
  assert.deepEqual(await f.store.exportIds(filters),expected);
  assert.equal((await f.api('collections',RECRUITER,{action:'add',id,revision:2,ids:[f.b]})).status,200);
  const page=await f.store.applications(filters);assert.deepEqual(page.items.map(a=>a.id),expected);
  const navigation=await f.store.applicationNavigation(f.a,filters);assert.equal(navigation.previousId,f.c);assert.equal(navigation.nextId,f.b);
  assert.equal((await f.api('collections',RECRUITER,{action:'prioritize',id,revision:3,ids:['unknown']})).status,409);
  assert.deepEqual(await f.store.exportIds(filters),expected);
});

test('list reviews freeze requested applications, share private feedback internally, and never change stages or queue email', async t=>{
  const f=await setup();t.after(()=>f.database.close());
  const other={userId:'other',role:'recruiter' as const,email:'other@example.invalid'};
  f.database.prepare("INSERT INTO hub_members(id,email,role,active,created_at,updated_at) VALUES (?,?,?,1,0,0)").run(RECRUITER.userId,RECRUITER.email,RECRUITER.role);
  const listId=await f.create({kind:'list',name:'Friday review',visibility:'team',ids:[f.a,f.b]});
  const privateId=await f.create({kind:'list',name:'Private',visibility:'personal',ids:[f.a]});
  const requestId=crypto.randomUUID();
  const request={action:'request',listId,revision:1,requestId,reviewer:RECRUITER.email,prompt:'Which candidate should we speak with?'};
  const tasksBefore=f.database.prepare("SELECT COUNT(*) AS n FROM hub_tasks").get()!.n;
  assert.equal((await f.api('list-reviews',MANAGER,{...request,reviewer:'inactive@example.invalid'})).status,422);
  assert.equal((await f.api('list-reviews',MANAGER,{...request,listId:privateId})).status,409);
  assert.equal((await f.api('list-reviews',MANAGER,request)).status,200);
  assert.equal((await f.api('list-reviews',MANAGER,request)).status,200);
  assert.equal((await f.api('collections',MANAGER,{action:'remove',id:listId,revision:1,ids:[f.b]})).status,200);
  assert.equal((await f.api('collections',MANAGER,{action:'add',id:listId,revision:2,ids:[f.c]})).status,200);
  const detail=await data<{items:{applicationId:string}[];canRespond:boolean}>(await f.api('list-reviews/'+requestId,RECRUITER));
  assert.deepEqual(detail.items.map(x=>x.applicationId),[f.a,f.b]);assert.equal(detail.canRespond,true);
  assert.equal((await f.api('list-reviews/'+requestId,other)).status,404);
  const inbox=async(box:string,status:string,person:HubMember)=>data<{total:number;items:{completed:number;total:number}[]}>(await f.api('list-reviews?box='+box+'&status='+status,person));
  assert.equal((await inbox('sent','open',MANAGER)).total,1);assert.equal((await inbox('received','open',RECRUITER)).total,1);
  assert.equal((await inbox('received','open',other)).total,0);
  const reply={action:'review',requestId,applicationId:f.a,feedback:'Discuss the portfolio.'};
  assert.equal((await f.api('list-reviews',MANAGER,reply)).status,403);
  assert.equal((await f.api('list-reviews',RECRUITER,reply)).status,200);
  assert.equal((await f.api('list-reviews',RECRUITER,reply)).status,200);
  assert.equal((await f.api('list-reviews',RECRUITER,{...reply,feedback:'Changed stale draft'})).status,409);
  assert.equal((await inbox('sent','open',MANAGER)).items[0].completed,1);
  assert.equal((await f.api('list-reviews',RECRUITER,{...reply,applicationId:f.b,feedback:''})).status,200);
  assert.equal((await inbox('received','open',RECRUITER)).total,0);
  assert.equal((await inbox('sent','completed',MANAGER)).total,1);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_tasks").get()!.n,tasksBefore);
  assert.equal((await f.store.getApplication(f.a)).stage,'Application Review');
  const result=await data<{items:{feedback:string}[]}>(await f.api('list-reviews/'+requestId,MANAGER));
  assert.equal(result.items[0].feedback,'Discuss the portfolio.');
});

test('an owned server selection adds every selected application across pages and refuses an expired or other recruiter snapshot', async t=>{
  const f=await setup();t.after(()=>f.database.close());
  const id=await f.create({kind:'list',name:'Multi-page review',visibility:'team'});
  const role=await f.store.saveJob(jobInput());
  for(let index=0;index<101;index++) await f.store.acceptApplication(applicationInput(role.id));
  const snapshot=await data<{selectionId:string}>(await f.api('application-selections?jobId='+role.id,RECRUITER,{}));
  const add={action:'add',id,revision:1,selectionId:snapshot.selectionId};
  assert.equal((await f.api('collections',MANAGER,add)).status,409);
  assert.equal((await f.api('collections',RECRUITER,add)).status,200);
  assert.equal((await f.apps(id)).total,101);
  f.database.prepare("UPDATE hub_settings SET value=json_set(value,'$.expiresAt',0) WHERE key=?").run('application_selection:'+snapshot.selectionId);
  assert.equal((await f.api('collections',RECRUITER,{...add,revision:2})).status,409);
});
