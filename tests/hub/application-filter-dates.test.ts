import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDateBounds} from '../../lib/hub/store';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {handleHubRequest} from '../../lib/hub/http';
import {downloadApplications} from '../../lib/hub/exports';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

test('applied calendar date bounds include full local day and DST transitions',()=>{
 assert.deepEqual(applicationDateBounds({appliedFrom:'2026-10-15',appliedTo:'2026-10-15',timeZone:'America/Bogota'}),{from:Date.parse('2026-10-15T05:00:00Z'),to:Date.parse('2026-10-16T05:00:00Z')});
 for(const [day,hours] of [['2026-03-08',23],['2026-11-01',25]] as const){const bounds=applicationDateBounds({appliedFrom:day,appliedTo:day,timeZone:'America/New_York'});assert.equal(bounds.to!-bounds.from!,hours*3600000);}
 // Santiago advances at midnight, so the first instant is 01:00, not a nonexistent midnight.
 const skippedMidnight=applicationDateBounds({appliedFrom:'2026-09-06',appliedTo:'2026-09-06',timeZone:'America/Santiago'});
 assert.equal(skippedMidnight.to!-skippedMidnight.from!,23*3600000);
 assert.deepEqual(applicationDateBounds({appliedFrom:'2026-01-01',timeZone:'UTC'}),{from:Date.parse('2026-01-01T00:00Z'),to:undefined});
});

test('HTTP date validation rejects invalid days, backwards ranges and missing/invalid zones',async()=>{
 const {store,database}=createStore();try {
  for(const query of ['appliedFrom=2026-02-30&timeZone=UTC','appliedFrom=2026-10-20&appliedTo=2026-10-01&timeZone=UTC','appliedTo=2026-10-15','appliedTo=2026-10-15&timeZone=wrong','appliedFrom=invalid&timeZone=UTC']){
   for(const route of ['applications','applications-export']){
    const response=await handleHubRequest(new Request(`https://jobs.example.invalid/api/hub/${route}?${query}`),[route],MANAGER,store);
    assert.equal(response.status,422,query);
   }
  }
 }finally{database.close();}
});

test('requirements and date filters select exact same cohort across pages, CSV, JSON and PDF ZIP',async()=>{
 const {store,database}=createStore();const dir=mkdtempSync(join(tmpdir(),'application-dates-'));
 try {
  const job=await store.saveJob(jobInput()),other=await store.saveJob(jobInput());
  const ids:string[]=[];
  for(let n=0;n<65;n++){
   const app=await store.acceptApplication(applicationInput(job.id));ids.push(app.id);
   database.prepare("UPDATE hub_applications SET qualification='pass',created_at=? WHERE id=?").run(Date.parse('2026-10-15T05:00:00Z')+n,app.id);
  }
  // A full first/last millisecond and non-matching records deliberately cover all exclusions.
  database.prepare('UPDATE hub_applications SET created_at=? WHERE id=?').run(Date.parse('2026-10-16T04:59:59.999Z'),ids[64]);
  for(const [qualification,date,jobId,trash] of [
   ['pass','2026-10-15T04:59:59.999Z',job.id,false],['pass','2026-10-16T05:00:00Z',job.id,false],
   ['fail','2026-10-15T12:00Z',job.id,false],['review','2026-10-15T12:00Z',job.id,false],
   ['pass','2026-10-15T12:00Z',other.id,false],['pass','2026-10-15T12:00Z',job.id,true],
  ] as const){const app=await store.acceptApplication(applicationInput(jobId));database.prepare('UPDATE hub_applications SET qualification=?,created_at=? WHERE id=?').run(qualification,Date.parse(date),app.id);if(trash)database.prepare('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)').run('application_trash:'+app.id,JSON.stringify({deletedAt:Date.now()}),Date.now());}
  const filters={jobId:job.id,qualification:'pass' as const,appliedFrom:'2026-10-15',appliedTo:'2026-10-15',timeZone:'America/Bogota'};
  const listed:string[]=[];
  for(let page=1;page<=3;page++){const result=await store.applications({...filters,page});assert.equal(result.total,65);listed.push(...result.items.map(row=>row.id));}
  assert.deepEqual(new Set(listed),new Set(ids));assert.equal(listed.length,65);
  assert.deepEqual(await store.exportIds({...filters,page:2}),listed);
  assert.deepEqual((await store.exportApplications(filters)).items.map(row=>row.id),listed);
  const query=new URLSearchParams(filters);
  const http=await handleHubRequest(new Request(`https://jobs.example.invalid/api/hub/applications?${query}`),['applications'],MANAGER,store);
  assert.equal(http.status,200);assert.equal((await http.json() as {data:{total:number}}).data.total,65);
  const csv=await downloadApplications(new Request('https://jobs.example.invalid/?format=csv'),store,{...filters,page:3});
  assert.equal(csv.headers.get('X-Application-Count'),'65');const csvText=await csv.text();for(const id of ids)assert.ok(csvText.includes(id));
  const zip=await downloadApplications(new Request('https://jobs.example.invalid/?format=zip'),store,{...filters,page:2},{get:async()=>null} as unknown as Pick<R2Bucket,'get'>);
  const path=join(dir,'cohort.zip');writeFileSync(path,Buffer.from(await zip.arrayBuffer()));
  const names=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
assert all(z.read(n).startswith(b'%PDF-') for n in z.namelist())
print(json.dumps(z.namelist()))`,path],{encoding:'utf8'})) as string[];
  assert.equal(names.length,66);assert.equal(names.filter(n=>n.endsWith('/Application summary.pdf')).length,65);
  assert.deepEqual(new Set(names.filter(n=>n.includes('/')).map(n=>ids.find(id=>n.includes(id)))),new Set(ids));
 }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('3,000 matching applications are available without a 1,000-record cutoff; larger exports fail explicitly',async()=>{
 const {store,database}=createStore();try {
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
  const row=database.prepare('SELECT * FROM hub_applications WHERE id=?').get(app.id)!;
  const columns=Object.keys(row),insert=database.prepare(`INSERT INTO hub_applications (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  const add=(start:number,end:number)=>{database.exec('BEGIN');for(let n=start;n<end;n++){const id='synthetic-'+n;insert.run(...columns.map(column=>column==='id'||column==='submission_key_hash'?id:row[column]));}database.exec('COMMIT');};
  add(1,3000);
  assert.equal((await store.exportApplications({jobId:job.id})).items.length,3000);
  const ids=await store.exportIds({jobId:job.id,page:20});assert.equal(ids.length,3000);
  const explicit=new Request('https://jobs.example.invalid/?format=csv&check=1&ids='+ids.join(','));
  assert.equal((await (await downloadApplications(explicit,store,{jobId:job.id})).json() as {count:number}).count,3000);
  add(3000,10001);
  await assert.rejects(store.exportIds({jobId:job.id}),{code:'export_too_large'});
  await assert.rejects(store.exportApplications({jobId:job.id}),{code:'export_too_large'});
 }finally{database.close();}
});
