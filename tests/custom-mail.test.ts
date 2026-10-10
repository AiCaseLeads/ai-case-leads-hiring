import test from "node:test";
import assert from "node:assert/strict";
import { customDatabase,openSyntheticRole } from "./custom-fixture";
import { acceptLocalApplication } from "../lib/hiring/local";
import { syncHiringReplies } from "../lib/mail-sync";
import type { GoogleWorkspace } from "../lib/google/workspace";
async function outgoing(store:ReturnType<typeof customDatabase>["store"],db:D1Database,jobId:string,thread:string){
  await acceptLocalApplication(db,{jobPostingId:jobId,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]},"a".repeat(64),true);
  const row=await db.prepare("SELECT c.task_id,c.application_id,t.payload_json FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id WHERE c.thread_id IS NULL ORDER BY c.created_at DESC LIMIT 1").first<{task_id:string;application_id:string;payload_json:string}>();
  await db.prepare("UPDATE hub_communications SET status='sent',thread_id=?,provider_id=? WHERE task_id=?").bind(thread,`out-${thread}`,row!.task_id).run();
  return {...row!,messageId:JSON.parse(row!.payload_json).messageId};
}
function deltaFixture(google:GoogleWorkspace):GoogleWorkspace{
 return Object.assign(google,{async profile(){return {email:"recruiting@example.invalid",historyId:"1"};},async mailHistory(){return {historyId:"1",messages:[]};}});
}
function reply(thread:string,reference:string){return {id:`reply-${thread}`,threadId:thread,messageId:`<reply-${thread}@example.invalid>`,from:"Synthetic <synthetic@example.invalid>",subject:"Re: application",body:`My reply https://careers.invalid/assessment/${"f".repeat(64)}`,sent:false,createdAt:Date.now(),inReplyTo:reference,references:reference};}
test("one unreadable hiring thread cannot starve replies and imported records/archive tasks commit once",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store);await outgoing(store,db,role.id,"deleted");const healthy=await outgoing(store,db,role.id,"healthy");
    const google={async threadMessages(thread:string){if(thread==="deleted")throw new Error("deleted");return[reply(thread,healthy.messageId)];}} as unknown as GoogleWorkspace;
    assert.equal(await syncHiringReplies(store,db,deltaFixture(google),10),1);
    const received=await db.prepare("SELECT * FROM hub_communications WHERE status='received'").first<{application_id:string;body:string}>();
    assert.equal(received?.application_id,healthy.application_id);assert.equal(received?.body.includes("f".repeat(64)),false);
    assert.equal(await store.setting<string>("gmail_thread_error:deleted",""),"Google could not read this hiring thread. Check mailbox access or reconnect Workspace.");
    assert.match(await store.setting<string>("mail_sync_last_error",""),/Other threads continue/);
    await store.setSetting("gmail_thread_next_poll:healthy",0);
    assert.equal(await syncHiringReplies(store,db,deltaFixture(google),10),0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received'").get()?.n,1);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_tasks WHERE id LIKE 'drive:%:mail:%'").get()?.n,1);
  }finally{database.close();}
});
test("one shared Gmail thread uses exact reply references to separate applications",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),first=await outgoing(store,db,role.id,"shared"),second=await outgoing(store,db,role.id,"shared");
    assert.notEqual(first.application_id,second.application_id);
    const google={async threadMessages(){return[{...reply("shared",second.messageId),references:`${first.messageId} ${second.messageId}`,id:"unique-reply"}];}} as unknown as GoogleWorkspace;
    assert.equal(await syncHiringReplies(store,db,deltaFixture(google),10),1);
    assert.equal((await db.prepare("SELECT application_id FROM hub_communications WHERE status='received'").first<{application_id:string}>())?.application_id,second.application_id);
  }finally{database.close();}
});
test("ambiguous immediate reply parents do not select an application from older references",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),first=await outgoing(store,db,role.id,"ambiguous"),second=await outgoing(store,db,role.id,"ambiguous");
    const google={async threadMessages(){return[{...reply("ambiguous",`${first.messageId} ${second.messageId}`),references:second.messageId}];}} as unknown as GoogleWorkspace;
    assert.equal(await syncHiringReplies(store,db,deltaFixture(google),10),0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received'").get()?.n,0);
  }finally{database.close();}
});
test("reply import rolls back fully if its Drive task cannot be recorded",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),out=await outgoing(store,db,role.id,"failure"),before=(await store.applicationRow(out.application_id)).revision;
    database.exec("CREATE TRIGGER test_mail_archive_failure BEFORE INSERT ON hub_tasks WHEN NEW.id LIKE 'drive:%:mail:%' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const google={async threadMessages(){return[reply("failure",out.messageId)];}} as unknown as GoogleWorkspace;
    assert.equal(await syncHiringReplies(store,db,deltaFixture(google),10),0);
    assert.match(await store.setting("mail_sync_last_error",""),/need repair/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received'").get()?.n,0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_tasks WHERE id LIKE 'gmail-import:%'").get()?.n,0);
    assert.equal((await store.applicationRow(out.application_id)).revision,before);
  }finally{database.close();}
});
