import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {handleHubRequest} from '../../lib/hub/http';
import type {ApplicationFilters} from '../../lib/hub/store';

test('all-page sorts share exact export and navigation ordering with stable ties',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput());
  const rows:{id:string;time:number;rank:number;owner:string}[]=[];
  for(let i=0;i<65;i++){
   const {id}=await store.acceptApplication(applicationInput(job.id));
   const time=Date.parse('2026-10-15T12:00Z')+Math.floor(i/3),rank=i%3,owner=['Zed@example.invalid','amy@example.invalid',''][i%3];
   database.prepare('UPDATE hub_applications SET qualification=?,created_at=?,assignee=? WHERE id=?').run(['pass','review','fail'][rank],time,owner||null,id);
   rows.push({id,time,rank,owner:owner.toLowerCase()});
  }
  const recent=(a:typeof rows[number],b:typeof rows[number])=>b.time-a.time||(a.id<b.id?-1:a.id>b.id?1:0);
  const sorts:ApplicationFilters['sort'][]=['newest','oldest','screening_newest','screening_asc','screening_desc','owner_asc','owner_desc'];
  for(const sort of sorts){
   const expected=[...rows].sort((a,b)=>{
    if(sort==='oldest')return a.time-b.time||(a.id<b.id?-1:a.id>b.id?1:0);
    if(sort?.startsWith('screening'))return (a.rank-b.rank)*(sort==='screening_desc'?-1:1)||recent(a,b);
    if(sort?.startsWith('owner'))return Number(!a.owner)-Number(!b.owner)||((a.owner<b.owner?-1:a.owner>b.owner?1:0)*(sort==='owner_desc'?-1:1))||recent(a,b);
    return recent(a,b);
   }).map(x=>x.id);
   const filters={sort,appliedFrom:'2026-10-15',appliedTo:'2026-10-15',timeZone:'America/Bogota'};
   const actual=[];for(let page=1;page<=3;page++)actual.push(...(await store.applications({...filters,page})).items.map(x=>x.id));
   assert.deepEqual(actual,expected,sort);
   assert.deepEqual((await store.exportApplications(filters)).items.map(x=>x.id),expected,sort);
   assert.deepEqual(await store.exportIds({...filters,jobId:job.id}),expected,sort);
   assert.deepEqual(await store.applicationNavigation(expected[29],filters),{previousId:expected[28],nextId:expected[30],position:30,total:65},sort);
   const response=await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/applications?'+new URLSearchParams({...filters,sort:sort!})),['applications'],MANAGER,store);
   assert.equal(response.status,200,sort);
  }
 }finally{database.close();}
});

test('ascending AI match keeps pending and terminal applicants behind active completed matches',async()=>{
 const {store,database}=createStore();try{
  const job=await store.saveJob(jobInput());database.prepare('UPDATE hub_jobs SET ai_match_enabled=1 WHERE id=?').run(job.id);
  const ids=[];
  for(const score of [80,20,null,10]){const {id}=await store.acceptApplication(applicationInput(job.id));ids.push(id);if(score!==null)database.prepare("INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,updated_at) VALUES(?,?,?,'ready',?,1)").run(id,job.id,job.formVersion,score);}
  database.prepare("UPDATE hub_applications SET stage='Rejected' WHERE id=?").run(ids[3]);
  const filters={jobId:job.id,sort:'ai_match_asc' as const};
  assert.deepEqual(await store.exportIds(filters),[ids[1],ids[0],ids[2],ids[3]]);
  assert.deepEqual((await store.applications(filters)).items.map(x=>x.id),[ids[1],ids[0],ids[2],ids[3]]);
  for(const query of ['sort=ai_match_asc','sort=invalid',`sort=ai_match_asc&jobId=${job.id}&top=10`])assert.equal((await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/applications?'+query),['applications'],MANAGER,store)).status,422);
 }finally{database.close();}
});
