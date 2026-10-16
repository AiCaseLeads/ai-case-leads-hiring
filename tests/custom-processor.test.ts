import { automaticFixture } from './hub/automatic-fixture';
import test from "node:test";
import assert from "node:assert/strict";
import {customDatabase,openSyntheticRole} from "./custom-fixture";
import {processHubTasks} from "../lib/task-runner";
import type {GoogleWorkspace} from "../lib/google/workspace";
const manager={email:"manager@example.invalid",userId:"synthetic-manager",role:"admin" as const};
const bucket={} as R2Bucket;
async function application(store:ReturnType<typeof customDatabase>["store"],jobId:string){return store.acceptApplication({jobPostingId:jobId,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]},"a".repeat(64));}
function googleArchive(archive:(detail:Record<string,unknown>)=>Promise<unknown>){return {archiveApplication:async(detail:Record<string,unknown>)=>({...await archive(detail) as Record<string,unknown>,archiveFormat:"pdf-v2",legacyJsonFileIds:[]}),async profile(){return{email:"recruiting@example.invalid",historyId:"1"};},async mailHistory(){return{historyId:"1",messages:[]};},async threadMessages(){return[];},async reconcileMail(){return null;}} as unknown as GoogleWorkspace;}
test("archive tasks defer each R2 read to the individual file loader",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),app=await application(store,role.id);
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks WHERE kind='gmail'");
    for(let index=0;index<2;index++)await db.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,'resume.pdf','application/pdf',3,?,?,?,?,?)").bind(`file-${index}`,role.id,`file${index}`,`key${index}`,Date.now(),app.id,Number.MAX_SAFE_INTEGER,"a".repeat(64)).run();
    const reads:string[]=[];
    const originals={async get(key:string){reads.push(key);return {size:3,customMetadata:{fileId:`file-${key.at(-1)}`},async arrayBuffer(){return new Uint8Array([1,2,3]).buffer;}};}} as unknown as R2Bucket;
    const google=googleArchive(async()=>assert.fail("replaced below"));
    google.archiveApplication=async(detail,sources,_existing,checkpoint)=>{
      assert.equal(reads.length,0);assert.equal(sources.length,2);assert.equal(await checkpoint!.read(),0);
      for(let index=0;index<sources.length;index++){
        const source=sources[index];assert.ok("load" in source);
        assert.deepEqual(await source.load(),new Uint8Array([1,2,3]));
        assert.equal(reads.length,index+1);await checkpoint!.write(index+1);
      }
      return {folderId:"synthetic-folder",folderUrl:"https://drive.google.com/drive/folders/synthetic-folder",archivedRevision:detail.revision,archiveFormat:"pdf-v2",legacyJsonFileIds:[]};
    };
    assert.equal((await processHubTasks(store,db,originals,google,1)).healthy,true);
    assert.equal(reads.length,2);
  }finally{database.close();}
});
test("worker health remains unhealthy while an integration failure awaits retry",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store);await application(store,role.id);
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks WHERE kind='gmail'");
    const google=googleArchive(async()=>{throw {code:"synthetic_drive_outage"};});
    const first=await processHubTasks(store,db,bucket,google,1);assert.equal(first.healthy,false);
    const second=await processHubTasks(store,db,bucket,google,1);assert.equal(second.processed,0);assert.equal(second.healthy,false);
    const health=await store.setting<{failed:number;lastCompletedAt:number;lastSuccessfulAt:number|null}>("worker_health",{failed:0,lastCompletedAt:0,lastSuccessfulAt:null});
    assert.ok(health.failed>=1);assert.ok(health.lastCompletedAt);assert.equal(health.lastSuccessfulAt,null);
  }finally{database.close();}
});
test("archive reconciliation compares saved application revision rather than a later task timestamp",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),app=await application(store,role.id);
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");
    await store.action(app.id,{action:"note",text:"New synthetic note",expectedRevision:(await store.getApplication(app.id)).revision},manager);
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");
    await db.prepare("INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,result_json,created_at,updated_at) VALUES (?,?,'drive',?,'done',1,?,?,?,?)").bind("old-archive",app.id,JSON.stringify({applicationId:app.id}),Date.now(),JSON.stringify({archivedRevision:1}),Date.now(),Date.now()+100000).run();
    const revisions:number[]=[];
    await processHubTasks(store,db,bucket,googleArchive(async detail=>{revisions.push(Number(detail.revision));return{folderId:"synthetic-folder",folderUrl:"https://drive.google.com/drive/folders/synthetic-folder"};}),5);
    assert.deepEqual(revisions,[2]);
    assert.equal((await store.applicationRow(app.id)).revision,2);
  }finally{database.close();}
});
test("an expired old archive cannot erase a newer revision and cannot finish a newer lease",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),app=await application(store,role.id);
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks WHERE kind='gmail'");
    let signal!:()=>void,release!:()=>void;
    const captured=new Promise<void>(resolve=>{signal=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
    let calls=0;
    const snapshots=new Map<number,Record<string,unknown>>();
    const google=googleArchive(async detail=>{
      const copy=structuredClone(detail);calls++;
      if(calls===1){signal();await resume;}
      snapshots.set(Number(copy.revision),copy);
      return{folderId:"synthetic-folder",folderUrl:"https://drive.google.com/drive/folders/synthetic-folder"};
    });
    const old=processHubTasks(store,db,bucket,google,1);
    await captured;
    await store.action(app.id,{action:"note",text:"Current synthetic note",expectedRevision:(await store.getApplication(app.id)).revision},manager);
    database.exec("UPDATE hub_tasks SET lease_until=0 WHERE status='running'");
    await processHubTasks(store,db,bucket,google,5);
    release();
    await assert.rejects(old,{code:"task_lease_lost"});
    assert.equal((snapshots.get(2)?.notes as unknown[]).length,1);
    assert.equal((snapshots.get(1)?.notes as unknown[]).length,0);
    const before=calls;
    await processHubTasks(store,db,bucket,google,5);
    assert.equal(calls,before);
    assert.ok(database.prepare("SELECT id FROM hub_tasks WHERE status='done' AND json_extract(result_json,'$.archivedRevision')=2").get());
  }finally{database.close();}
});
test("100 permanent archive reconciliation failures cannot starve a new application",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),ids:string[]=[];
    for(let n=0;n<101;n++)ids.push((await application(store,role.id)).id);
    database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");
    for(const id of ids.slice(0,100))await db.prepare("INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) VALUES (?,?,'drive',?,'failed',8,?,?,?)").bind(`drive:${id}:reconcile:1`,id,JSON.stringify({applicationId:id}),0,0,0).run();
    const archived:string[]=[];
    await processHubTasks(store,db,bucket,googleArchive(async detail=>{archived.push(String(detail.id));return{folderId:"synthetic-folder",folderUrl:"https://drive.google.com/drive/folders/synthetic-folder"};}),5);
    assert.deepEqual(archived,[ids[100]]);
  }finally{database.close();}
});
test("an automatic send followed by local result-persistence failure remains uncertain and never resends",async(t)=>{
 const prior=process.env.CANDIDATE_MAIL_ACCOUNT;process.env.CANDIDATE_MAIL_ACCOUNT="mariam@aicaseleads.com";t.after(()=>{if(prior===undefined)delete process.env.CANDIDATE_MAIL_ACCOUNT;else process.env.CANDIDATE_MAIL_ACCOUNT=prior;});
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),app=await application(store,role.id);
    database.exec("CREATE TRIGGER test_sent_archive_failure BEFORE INSERT ON hub_tasks WHEN NEW.kind='drive' AND NEW.id LIKE '%:effect:%' AND EXISTS (SELECT 1 FROM hub_tasks WHERE kind='gmail' AND status='done') BEGIN SELECT RAISE(ABORT,'synthetic post-send database outage'); END");
    let sends=0;
    const google=googleArchive(async()=>({folderId:"synthetic-folder",folderUrl:"https://drive.google.com/drive/folders/synthetic-folder"}));
    google.sendMail=async()=>{sends++;return{id:"synthetic-sent-id",threadId:"synthetic-thread"};};
    await processHubTasks(store,db,bucket,google,5,[],async()=>google,async()=>automaticFixture(async mail=>({...await google.sendMail(mail)})));
    assert.equal(sends,1);
    assert.equal(database.prepare("SELECT status FROM hub_tasks WHERE kind='gmail'").get()?.status,"uncertain");
    assert.equal((await store.getApplication(app.id)).communications[0].status,"uncertain");
    database.exec("UPDATE hub_tasks SET run_after=0 WHERE kind='gmail'");
    await processHubTasks(store,db,bucket,google,5,[],async()=>google,async()=>automaticFixture(async mail=>({...await google.sendMail(mail)})));
    assert.equal(sends,1);
    assert.equal(database.prepare("SELECT status FROM hub_tasks WHERE kind='gmail'").get()?.status,"uncertain");
  }finally{database.close();}
});
for(const scenario of ["current","disabled","cancelled","rescheduled","past","inactive"]){
  test(`interview reminder processor: ${scenario} booking is checked before automatic mail`,async(t)=>{
 const prior=process.env.CANDIDATE_MAIL_ACCOUNT;process.env.CANDIDATE_MAIL_ACCOUNT="mariam@aicaseleads.com";t.after(()=>{if(prior===undefined)delete process.env.CANDIDATE_MAIL_ACCOUNT;else process.env.CANDIDATE_MAIL_ACCOUNT=prior;});
    const {database,db,store}=customDatabase();try{
      const role=await openSyntheticRole(store),app=await application(store,role.id);
      database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");
      await store.setSetting("interview_reminders_enabled",scenario!=="disabled");
      const start=new Date(Date.now()+(scenario==="past"?-1:48)*3600000).toISOString();
      await db.prepare("INSERT INTO hub_interviews (id,application_id,status,start,end,time_zone,calendar_id,revision,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 'UTC','synthetic-calendar',?, ?, ?)").bind("synthetic-interview",app.id,scenario==="cancelled"?"cancelled":"booked",start,new Date(Date.parse(start)+1800000).toISOString(),scenario==="rescheduled"?2:1,Date.now(),Date.now()).run();
      if(scenario==="inactive")await db.prepare("UPDATE hub_applications SET stage='Rejected' WHERE id=?").bind(app.id).run();
      const id=`gmail:${app.id}:reminder:synthetic-interview:1:1h`;
      const payload={to:"synthetic@example.invalid",subject:"Synthetic interview reminder",body:"Synthetic",messageId:`<${id}@example.invalid>`,reminder:true,interviewId:"synthetic-interview",revision:1,interviewStart:start};
      await db.batch([store.taskStatement(id,app.id,"gmail",payload,Date.now()),db.prepare("INSERT INTO hub_communications (id,application_id,task_id,subject,body,status,created_at,updated_at) VALUES (?, ?, ?, 'Synthetic', 'Synthetic','pending',?,?)").bind(`communication:${id}`,app.id,id,Date.now(),Date.now())]);
      let sends=0;
      const google=googleArchive(async()=>({folderId:"synthetic-folder",folderUrl:"https://drive.google.com/drive/folders/synthetic-folder"}));
      google.sendMail=async()=>{sends++;return{id:"synthetic-message",threadId:"synthetic-thread"};};
      await processHubTasks(store,db,bucket,google,5,[],async()=>google,async()=>automaticFixture(async mail=>({...await google.sendMail(mail)})));
      assert.equal(sends,scenario==="current"?1:0);
      assert.equal(database.prepare("SELECT status FROM hub_communications WHERE task_id=?").get(id)?.status,scenario==="current"?"sent":"cancelled");
    }finally{database.close();}
  });
}

test("missing automatic email never falls back to company sales and does not block Drive",async(t)=>{
 const prior=process.env.CANDIDATE_MAIL_ACCOUNT;process.env.CANDIDATE_MAIL_ACCOUNT="mariam@aicaseleads.com";
 t.after(()=>{if(prior===undefined)delete process.env.CANDIDATE_MAIL_ACCOUNT;else process.env.CANDIDATE_MAIL_ACCOUNT=prior;});
 const {database,db,store}=customDatabase();try{
  const role=await openSyntheticRole(store);await application(store,role.id);let archives=0;
  const google=googleArchive(async()=>{archives++;return{folderId:"folder",folderUrl:"https://drive.google.com/drive/folders/folder"};});
  google.sendMail=async()=>assert.fail("company account must never send mail");
  await processHubTasks(store,db,bucket,google,5,[],async()=>null);
  assert.ok(archives>=1);assert.equal(database.prepare("SELECT status FROM hub_tasks WHERE kind='gmail'").get()?.status,"failed");
  assert.equal(database.prepare("SELECT last_error FROM hub_tasks WHERE kind='gmail'").get()?.last_error,"transactional_mail_key_required");
 }finally{database.close();}
});


test("missing mail setup is held without consuming retries; connecting never sends the backlog until explicit review",async(t)=>{
 const prior=process.env.CANDIDATE_MAIL_ACCOUNT;process.env.CANDIDATE_MAIL_ACCOUNT="mariam@aicaseleads.com";
 t.after(()=>{if(prior===undefined)delete process.env.CANDIDATE_MAIL_ACCOUNT;else process.env.CANDIDATE_MAIL_ACCOUNT=prior;});
 const {database,db,store}=customDatabase();try{
  const role=await openSyntheticRole(store);await application(store,role.id);
  const company=googleArchive(async()=>({folderId:"folder",folderUrl:"https://drive.google.com/drive/folders/folder"}));
  company.sendMail=async()=>assert.fail("sales must never send");
  await processHubTasks(store,db,bucket,company,5,[],async()=>null);
  const held=(await store.tasks()).find(task=>task.kind==="gmail")!;
  assert.equal(held.attempts,0);assert.equal(held.result?.setupRequired,true);assert.equal(held.result?.retryRequiresReview,true);
  let sends=0;const mail=googleArchive(async()=>({}));mail.sendMail=async()=>{sends++;return{id:"sent",threadId:"thread"};};
  // Even forcing the old retry time due cannot bypass the setup-error exclusion.
  database.prepare("UPDATE hub_tasks SET run_after=0,attempts=7 WHERE id=?").run(held.id);
  await processHubTasks(store,db,bucket,company,5,[],async()=>mail,async()=>automaticFixture(async input=>({...await mail.sendMail(input)})));
  assert.equal(sends,0);assert.equal((await store.tasks()).find(task=>task.id===held.id)!.attempts,7);
  await store.retryTask(held.id);
  await processHubTasks(store,db,bucket,company,5,[],async()=>mail,async()=>automaticFixture(async input=>({...await mail.sendMail(input)})));
  assert.equal(sends,1);assert.equal((await store.tasks()).find(task=>task.id===held.id)!.status,"done");
 }finally{database.close();}
});
