import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {handleHubRequest} from '../../lib/hub/http';

test('active scope intersects included/excluded stages consistently across pages, exports, navigation and bulk preview',async()=>{
 const {store,database}=createStore();try{
 const job=await store.saveJob(jobInput());
 for(let i=0;i<70;i++){const app=await store.acceptApplication(applicationInput(job.id));database.prepare("UPDATE hub_applications SET stage=?,qualification='pass',created_at=? WHERE id=?").run(i<35?'Application Review':i<65?'Screening':'Rejected',Date.parse('2026-10-15T12:00Z')+i,app.id);}
 const base={jobId:job.id,active:true,qualification:'pass' as const,sort:'newest' as const,appliedFrom:'2026-10-15',appliedTo:'2026-10-15',timeZone:'America/Bogota'};
 const only={...base,stage:'Screening'};assert.equal((await store.applications(only)).total,30);
 const excluded={...base,excludeStage:'Screening'},first=await store.applications(excluded),second=await store.applications({...excluded,page:2});
 assert.equal(first.total,35);assert.equal(second.items.length,5);
 const ids=[...first.items,...second.items].map(app=>app.id);
 assert.deepEqual(await store.exportIds(excluded),ids);assert.deepEqual((await store.exportApplications(excluded)).items.map(app=>app.id),ids);
 assert.equal((await store.applicationNavigation(first.items[29].id,excluded)).nextId,second.items[0].id);
 assert.equal((await store.previewBulkRejection(excluded,undefined,'Not selected',MANAGER)).count,35);
 assert.equal((await store.applications({...base,stage:'Rejected'})).total,5,'explicit stage overrides the default active scope');
 assert.equal((await store.applications({jobId:job.id,stage:'Rejected'})).total,5,'legacy terminal-stage URL without active remains available');
 assert.equal((await store.applications({...only,excludeStage:'Screening'})).total,0);
 const query=new URLSearchParams({jobId:job.id,active:'true',excludeStage:'Screening'});
 const response=await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/applications?'+query),['applications'],MANAGER,store);
 assert.equal(response.status,200);assert.equal((await response.json() as {data:{total:number}}).data.total,35);
 const bad=await handleHubRequest(new Request('https://jobs.example.invalid/api/hub/applications?excludeStage=invalid'),['applications'],MANAGER,store);assert.equal(bad.status,422);
 }finally{database.close();}
});
