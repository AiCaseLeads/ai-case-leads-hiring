import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, jobInput, applicationInput } from './fixtures';
import { exportApplicants, searchApplicants } from '../../lib/agent-api/bulk-read';
import { AgentReadError } from '../../lib/agent-api/errors';
import { RESUME_TEXT_VERSION } from '../../lib/resume-text/cache';

async function setup() {
  const fixture = createStore();
  const first = await fixture.store.saveJob(jobInput());
  const second = await fixture.store.saveJob(jobInput());
  async function app(jobId = first.id, email = `${crypto.randomUUID()}@example.invalid`, values: Record<string, unknown> = {}) {
    const input = applicationInput(jobId);
    input.fieldSubmissions = [...input.fieldSubmissions.filter(value => value.path !== '_systemfield_email'), {path: '_systemfield_email', value: email.trim().toLowerCase()}];
    const result = await fixture.store.acceptApplication(input);
    // Exercise historical case and whitespace handling independently of current write normalization.
    fixture.database.prepare('UPDATE hub_applications SET email=?,answers_json=? WHERE id=?').run(email, JSON.stringify([...input.fieldSubmissions,...Object.entries(values).map(([path,value])=>({path,value}))]), result.id);
    return result;
  }
  function resume(applicationId: string, jobId = first.id, text = 'Built offline conversion tools', options: {status?:string; truncated?:number; stale?:boolean; fieldPath?:string} = {}) {
    const fileId = crypto.randomUUID(), now = Date.now();
    fixture.database.prepare('INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(fileId, jobId, options.fieldPath || '_systemfield_resume', 'Synthetic.pdf', 'application/pdf', 42, 'private/not-returned/'+fileId, now, applicationId, now + 100000, 'x');
    fixture.database.prepare('INSERT INTO hub_file_text(file_id,uploaded_at,size,content_type,parser_version,status,text,truncated,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(fileId, now, options.stale ? 1 : 42, 'application/pdf', RESUME_TEXT_VERSION, options.status || 'ready', text, options.truncated || 0, now, now);
    return fileId;
  }
  return {...fixture, first, second, app, resume};
}
function params(value: Record<string,string>) { return new URLSearchParams(value); }

test('bulk paging groups normalized emails across jobs without splitting and counts scoped/global duplicates', async () => {
  const s = await setup();
  const a = await s.app(s.first.id, 'Person@example.invalid');
  const b = await s.app(s.second.id, ' person@EXAMPLE.invalid ');
  await s.app(s.first.id, 'zebra@example.invalid');
  const p = new URLSearchParams([['jobIds',s.first.id],['jobIds',s.second.id],['pageSize','1']]);
  const first = await exportApplicants(s.store,p);
  assert.equal(first.items.length,1);
  assert.equal(first.items[0].email,'person@example.invalid');
  assert.deepEqual(new Set(first.items[0].applications.map(app => app.applicationId)),new Set([a.id,b.id]));
  assert.deepEqual(first.items[0].duplicateEmail,{applicationCount:2,matchingApplications:2,jobCount:2});
  assert.equal(first.returnedApplications,2);
  assert.equal(first.hasMore,true);
  p.set('cursor',first.nextCursor!);
  const second = await exportApplicants(s.store,p);
  assert.equal(second.items[0].email,'zebra@example.invalid');
  assert.equal(second.hasMore,false);
  assert.equal(second.nextCursor,null);
  const scoped = await exportApplicants(s.store,params({jobId:s.first.id}));
  assert.equal(scoped.items[0].applications.length,1);
  assert.equal(scoped.items[0].duplicateEmail.applicationCount,2);
  s.database.close();
});

test('maximum page is 30 candidates; cursors reject malformed, changed filter and changed connection',async()=>{
  const s=await setup();
  for(let i=0;i<31;i++) await s.app(s.first.id,`person${String(i).padStart(2,'0')}@example.invalid`);
  const first=await exportApplicants(s.store,params({jobId:s.first.id}),{agentId:'one'});
  assert.equal(first.items.length,30);assert.equal(first.hasMore,true);
  const next=await exportApplicants(s.store,params({jobId:s.first.id,cursor:first.nextCursor!}),{agentId:'one'});
  assert.equal(next.items.length,1);assert.equal(next.hasMore,false);
  for(const p of [params({jobId:s.first.id,cursor:'bad'}),params({jobId:s.second.id,cursor:first.nextCursor!}),params({jobId:s.first.id,pageSize:'31'})]) await assert.rejects(()=>exportApplicants(s.store,p),AgentReadError);
  await assert.rejects(()=>exportApplicants(s.store,params({jobId:s.first.id,cursor:first.nextCursor!}),{agentId:'two'}),{code:'invalid_cursor'});
  await assert.rejects(()=>exportApplicants(s.store,new URLSearchParams([['jobId',s.first.id],['jobIds',s.second.id]])),{code:'invalid_request'});
  await assert.rejects(()=>exportApplicants(s.store,new URLSearchParams()),{code:'invalid_request'});
  s.database.close();
});

test('blank emails remain separate and Trash is excluded from rows, duplicates and coverage',async()=>{
  const s=await setup();
  const first=await s.app(),second=await s.app(),trash=await s.app(s.first.id,'person@example.invalid');
  s.database.prepare("UPDATE hub_applications SET email='' WHERE id IN (?,?)").run(first.id,second.id);
  s.database.prepare('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)').run(`application_trash:${trash.id}`,'{}',Date.now());
  const result=await exportApplicants(s.store,params({jobId:s.first.id}));
  assert.equal(result.items.length,2);assert.equal(result.returnedApplications,2);
  assert.equal(result.resumeCoverage.totalApplications,2);
  assert.equal(result.items[0].email,null);
  assert.notEqual(result.items[0].candidateId,result.items[1].candidateId);
  s.database.close();
});

test('search reads full cached résumé and submitted answer values and hydrates all selected applications',async()=>{
  const s=await setup();
  const a=await s.app(s.first.id,'person@example.invalid',{written:'Worked with PERSONAL INJURY teams'});
  const b=await s.app(s.second.id,'person@example.invalid');
  s.resume(a.id,s.first.id,'Full cached text with offline conversion and Unicode café');
  s.database.prepare('UPDATE hub_applications SET fields_json=? WHERE id=?').run(JSON.stringify([{path:'written',title:'Unrelated label',type:'LongText'},{path:'notAnswered',title:'Magical question label',type:'LongText'},{path:'_systemfield_resume',title:'Resume',type:'File'}]),a.id);
  const result=await searchApplicants(s.store,params({q:'offline conversion'}));
  assert.equal(result.items.length,1);assert.equal(result.items[0].applications.length,2);
  assert.equal(result.items[0].applications.find(app=>app.applicationId===a.id)?.resumeText,'Full cached text with offline conversion and Unicode café');
  assert.equal(result.items[0].applications.find(app=>app.applicationId===a.id)?.searchMatched,true);
  assert.equal(result.items[0].applications.find(app=>app.applicationId===b.id)?.searchMatched,false);
  assert.equal((await searchApplicants(s.store,params({q:'personal injury'}))).items.length,1);
  assert.equal((await searchApplicants(s.store,params({q:'Magical question label'}))).items.length,0);
  assert.equal((await searchApplicants(s.store,params({q:'offline conversion',jobId:s.second.id}))).items.length,0);
  assert.equal(result.resumeSearchComplete,false);
  assert.deepEqual(result.resumeCoverage,{totalApplications:2,applicationsWithResume:1,totalFiles:1,ready:1,pending:0,failed:0,partial:0});
  s.database.close();
});

test('search treats SQL wildcard/injection-looking phrases literally, excludes file answers and unrelated uploads',async()=>{
  const s=await setup();
  const a=await s.app(s.first.id,'literal@example.invalid',{written:'A 100%_literal phrase',nested:{text:'nested answer phrase'}});
  const b=await s.app(s.first.id,'other@example.invalid');
  s.resume(b.id,s.first.id,'Secret portfolio phrase',{fieldPath:'portfolio'});
  assert.equal((await searchApplicants(s.store,params({q:'%_'}))).items.length,1);
  assert.equal((await searchApplicants(s.store,params({q:'nested answer'}))).items.length,1);
  assert.equal((await searchApplicants(s.store,params({q:"' OR 1=1 --"}))).items.length,0);
  assert.equal((await searchApplicants(s.store,params({q:'Secret portfolio'}))).items.length,0);
  s.database.prepare('UPDATE hub_applications SET answers_json=? WHERE id=?').run(JSON.stringify([{path:'_systemfield_resume',value:'hidden file answer text'}]),a.id);
  assert.equal((await searchApplicants(s.store,params({q:'hidden file answer'}))).items.length,0);
  s.database.close();
});

test('cache-only reads expose pending, stale, partial and failed honestly and do not write or parse',async()=>{
  const s=await setup();
  const pending=await s.app(s.first.id,'pending@example.invalid'),partial=await s.app(s.first.id,'partial@example.invalid'),failed=await s.app(s.first.id,'failed@example.invalid');
  s.resume(pending.id,s.first.id,'stale text must not match',{stale:true});
  s.resume(partial.id,s.first.id,'partial résumé',{truncated:1});
  s.resume(failed.id,s.first.id,'failure text',{status:'password_protected'});
  const before=s.database.prepare('SELECT total_changes() n').get()!.n;
  const result=await exportApplicants(s.store,params({jobId:s.first.id}));
  assert.equal(s.database.prepare('SELECT total_changes() n').get()!.n,before);
  assert.equal(result.items.find(item=>item.email==='pending@example.invalid')?.applications[0].resumes[0].status,'pending');
  assert.equal(result.items.find(item=>item.email==='partial@example.invalid')?.applications[0].resumeComplete,false);
  assert.equal(result.items.find(item=>item.email==='failed@example.invalid')?.applications[0].resumeText,'');
  assert.deepEqual(result.resumeCoverage,{totalApplications:3,applicationsWithResume:3,totalFiles:3,ready:0,pending:1,failed:1,partial:1});
  assert.equal((await searchApplicants(s.store,params({q:'stale text'}))).items.length,0);
  assert.ok(!JSON.stringify(result).includes('private/not-returned'));
  s.database.close();
});

test('response budget reduces whole groups, preserves full text and next cursor, rejects oversized single group',async()=>{
  const s=await setup();
  for(const email of ['alpha@example.invalid','beta@example.invalid']){const app=await s.app(s.first.id,email);s.resume(app.id,s.first.id,'x'.repeat(3000));}
  const result=await exportApplicants(s.store,params({jobId:s.first.id}),{maxResponseBytes:7000});
  assert.equal(result.items.length,1);assert.equal(result.hasMore,true);
  assert.equal(result.items[0].applications[0].resumeText.length,3000);
  const next=await exportApplicants(s.store,params({jobId:s.first.id,cursor:result.nextCursor!}),{maxResponseBytes:7000});
  assert.equal(next.items.length,1);assert.equal(next.items[0].email,'beta@example.invalid');
  assert.equal(next.hasMore,false);
  await assert.rejects(()=>exportApplicants(s.store,params({jobId:s.first.id}),{maxResponseBytes:1000}),{code:'candidate_too_large',status:413,limit:{maxResponseBytes:1000,maxCandidates:30}});
  s.database.close();
});


test('full 200,000-character cached résumé, legacy contact fields and screening evidence are included',async()=>{
  const s=await setup();
  const app=await s.app(s.first.id,'large@example.invalid',{country:'Pakistan',legacy_linkedin:'https://www.linkedin.com/in/synthetic',experience:5});
  const fields=[{path:'country',title:'Country',type:'ValueSelect'},{path:'legacy_linkedin',title:'LinkedIn profile',type:'Url'},{path:'experience',title:'Years',type:'Number'},{path:'_systemfield_resume',title:'Resume',type:'File'}];
  s.database.prepare('UPDATE hub_applications SET fields_json=?,qualification_json=? WHERE id=?').run(JSON.stringify(fields),JSON.stringify([{fieldPath:'experience',matched:true,reason:'At least 3 years',value:5}]),app.id);
  s.resume(app.id,s.first.id,'full résumé text '.repeat(15000).slice(0,200000));
  const result=await exportApplicants(s.store,params({jobId:s.first.id}));
  const data=result.items[0].applications[0];
  assert.equal(data.resumeText.length,200000);
  assert.equal(data.resumeComplete,true);
  assert.equal(result.resumeSearchComplete,true);
  assert.deepEqual(data.country,{code:'PK',label:'Pakistan'});
  assert.equal(data.linkedIn,'https://www.linkedin.com/in/synthetic');
  assert.equal(data.screeningAnswers[0].screening[0].matched,true);
  assert.equal(data.qualificationEvidence[0].fieldPath,'experience');
  s.database.close();
});

test('snapshot excludes new applications, equivalent job order retains cursor and no pending work is created',async()=>{
  const s=await setup();
  await s.app(s.first.id,'alpha@example.invalid');await s.app(s.second.id,'zebra@example.invalid');
  const first=await exportApplicants(s.store,new URLSearchParams([['jobIds',s.first.id],['jobIds',s.second.id],['pageSize','1']]));
  const future=await s.app(s.first.id,'future@example.invalid');
  s.database.prepare('UPDATE hub_applications SET created_at=? WHERE id=?').run(first.asOf+1000,future.id);
  const second=await exportApplicants(s.store,new URLSearchParams([['jobIds',s.second.id],['jobIds',s.first.id],['pageSize','1'],['cursor',first.nextCursor!]]));
  assert.deepEqual(second.items.map(item=>item.email),['zebra@example.invalid']);
  assert.equal(second.hasMore,false);
  assert.equal(s.database.prepare('SELECT COUNT(*) n FROM hub_file_text').get()!.n,0);
  s.database.close();
});


test('if prefetched groups enter Trash during hydration, it returns a clear retry error instead of an unusable empty page',async()=>{
  const s=await setup();
  const apps=[await s.app(s.first.id,'alpha@example.invalid'),await s.app(s.first.id,'beta@example.invalid')];
  const original=s.store.rows.bind(s.store);
  let changed=false;
  s.store.rows=async <T>(sql:string,...values:(string|number|null)[])=>{
    const rows=await original<T>(sql,...values);
    if(!changed&&sql.includes('GROUP BY key')){
      changed=true;
      for(const app of apps)s.database.prepare('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)').run(`application_trash:${app.id}`,'{}',Date.now());
    }
    return rows;
  };
  await assert.rejects(()=>exportApplicants(s.store,params({jobId:s.first.id,pageSize:'1'})),{code:'applicants_changed',status:409,retryAfterSeconds:1});
  s.database.close();
});


test('exact final-page byte boundary has no phantom cursor or false applicants_changed retry',async()=>{
  const s=await setup();await s.app();
  const baseline=await exportApplicants(s.store,params({jobId:s.first.id}));
  const bytes=new TextEncoder().encode(JSON.stringify({data:baseline})).length;
  const exact=await exportApplicants(s.store,params({jobId:s.first.id}),{maxResponseBytes:bytes});
  assert.equal(exact.items.length,1);assert.equal(exact.hasMore,false);
  await assert.rejects(()=>exportApplicants(s.store,params({jobId:s.first.id}),{maxResponseBytes:bytes-1}),{code:'candidate_too_large',status:413});
  s.database.close();
});


test('application entering Trash after row hydration is excluded before final emission',async()=>{
  const s=await setup();const app=await s.app();s.resume(app.id);
  const original=s.store.rows.bind(s.store);let changed=false;
  s.store.rows=async <T>(sql:string,...values:(string|number|null)[])=>{
    const rows=await original<T>(sql,...values);
    if(!changed&&sql.startsWith('SELECT a.id,a.job_id')){
      changed=true;s.database.prepare('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)').run(`application_trash:${app.id}`,'{}',Date.now());
    }
    return rows;
  };
  const result=await exportApplicants(s.store,params({jobId:s.first.id}));
  assert.equal(result.items.length,0);assert.equal(result.returnedApplications,0);assert.equal(result.hasMore,false);
  assert.ok(!JSON.stringify(result).includes(app.id));
  s.database.close();
});


test('completed candidates remain downloadable before an oversized later group',async()=>{
  const s=await setup();await s.app(s.first.id,'alpha@example.invalid');
  const big=await s.app(s.first.id,'zebra@example.invalid');s.resume(big.id,s.first.id,'x'.repeat(10000));
  const first=await exportApplicants(s.store,params({jobId:s.first.id}),{maxResponseBytes:7000});
  assert.deepEqual(first.items.map(item=>item.email),['alpha@example.invalid']);
  assert.equal(first.hasMore,true);assert.ok(first.nextCursor);
  await assert.rejects(()=>exportApplicants(s.store,params({jobId:s.first.id,cursor:first.nextCursor!}),{maxResponseBytes:7000}),error=>error instanceof AgentReadError&&error.code==='candidate_too_large'&&error.status===413&&error.retryAfterSeconds===undefined);
  s.database.close();
});

test('unsupported résumé types are failed in coverage, with no misleading pending/retry state',async()=>{
  const s=await setup();const app=await s.app();const fileId=s.resume(app.id);
  s.database.prepare('UPDATE hub_files SET content_type=? WHERE id=?').run('image/png',fileId);
  s.database.prepare('DELETE FROM hub_file_text WHERE file_id=?').run(fileId);
  const result=await exportApplicants(s.store,params({jobId:s.first.id}));
  assert.equal(result.resumeCoverage.pending,0);assert.equal(result.resumeCoverage.failed,1);
  assert.equal(result.items[0].applications[0].resumes[0].status,'failed');
  assert.equal(result.items[0].applications[0].resumes[0].retryAfterSeconds,null);
  assert.equal(result.resumeSearchComplete,false);
  s.database.close();
});
