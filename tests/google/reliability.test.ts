import test from "node:test";
import assert from "node:assert/strict";
import { GoogleError, GoogleWorkspace, calendarEventId } from "../../lib/google/workspace";
import { customDatabase, openSyntheticRole } from "../custom-fixture";
import { samplePdf } from "../document-fixture";
import { syncHiringReplies } from "../../lib/mail-sync";
import { processHubTasks } from "../../lib/task-runner";
import { providerRequest } from "../../lib/archive/http";
type DeltaState = { historyId: string; pageToken?: string };
const sender="recruiting@example.invalid";
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
async function fixture(){
 const f=customDatabase(),role=await openSyntheticRole(f.store);
 const app=await f.store.acceptApplication({jobPostingId:role.id,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]},"a".repeat(64));
 const outgoing=f.database.prepare("SELECT c.task_id,t.payload_json FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id LIMIT 1").get()!;
 f.database.prepare("UPDATE hub_communications SET status='sent',provider_id='original',thread_id='linked' WHERE task_id=?").run(String(outgoing.task_id));
 f.database.prepare("UPDATE hub_tasks SET payload_json=json_set(payload_json,'$.deliveryAccount',?) WHERE id=?").run(sender,String(outgoing.task_id));
 const reference=JSON.parse(String(outgoing.payload_json)).messageId;
 await f.store.setSetting("gmail_delta_state_v1",{mailbox:sender,historyId:"100",catchupEpoch:"test"});
 await f.store.setSetting(`gmail_thread_caught_up:${sender}:test:linked`,true);
 const headers=[{name:"From",value:"synthetic@example.invalid"},{name:"Message-ID",value:"<reply@example.invalid>"},{name:"In-Reply-To",value:reference},{name:"Subject",value:"Re: application"}];
 return {...f,app,role,reference,headers};
}
function workspace(fetcher:typeof fetch){return new GoogleWorkspace({clientId:"synthetic",clientSecret:"synthetic",refreshToken:"synthetic",sender},fetcher);}
function bucketFixture(){const objects=new Map<string,{bytes:Uint8Array;metadata:Record<string,string>}>();let puts=0,fail=false;
 return {objects,puts:()=>puts,setFail:(value:boolean)=>{fail=value;},bucket:{async put(key:string,value:Uint8Array,options:{customMetadata:Record<string,string>}){if(fail)throw new Error("synthetic outage");puts++;objects.set(key,{bytes:new Uint8Array(value),metadata:options.customMetadata});}} as unknown as R2Bucket};}
for(const scenario of ["html","html-empty-plain","external-body","attachment","quarantine"]){
 test(`mail delta imports ${scenario}, preserves originals, and repeats without duplicates`,async()=>{
  const f=await fixture(),b=bucketFixture();let attachmentRequests=0,messageRequests=0;
  try{
   const body=new TextEncoder().encode("Confirmed from external body.");const pdf=new TextEncoder().encode(samplePdf());const bytes=scenario==="quarantine"?new Uint8Array([0x50,0x4b,3,4]):pdf;
   const htmlPart={mimeType:"text/html",body:{data:Buffer.from("<p>Confirmed &amp; ready.</p><script>alert('not rendered')</script>").toString("base64url")}};
   const payload=scenario==="html-empty-plain"?{mimeType:"multipart/alternative",headers:f.headers,parts:[{mimeType:"text/plain",body:{data:Buffer.from("  ").toString("base64url")}},htmlPart]}:scenario==="html"?{mimeType:"text/html",headers:f.headers,body:{data:Buffer.from("<p>Confirmed &amp; ready.</p><script>alert('not rendered')</script>").toString("base64url")}}:scenario==="external-body"?{mimeType:"text/plain",headers:f.headers,body:{attachmentId:"external",size:body.length}}:{mimeType:"multipart/mixed",headers:f.headers,parts:[{mimeType:"text/plain",body:{data:Buffer.from("Attached my portfolio.").toString("base64url")}},{partId:"2",filename:scenario==="quarantine"?"invalid.docx":"portfolio.pdf",mimeType:scenario==="quarantine"?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":"application/pdf",body:{attachmentId:"file",size:bytes.length}}]};
   const google=workspace(async(input)=>{
    const url=new URL(String(input));if(url.hostname==="oauth2.googleapis.com")return response({access_token:"synthetic",token_type:"Bearer",expires_in:3600});
    if(url.pathname.endsWith("/profile"))return response({emailAddress:sender,historyId:"100"});
    if(url.pathname.endsWith("/history"))return response({historyId:"101",history:[{messagesAdded:[{message:{id:"reply",threadId:"linked"}}]}]});
    if(url.pathname.endsWith("/messages/reply")){messageRequests++;return response({id:"reply",threadId:"linked",payload});}
    if(url.pathname.includes("/attachments/")){attachmentRequests++;return response({data:Buffer.from(url.pathname.endsWith("/external")?body:bytes).toString("base64url")});}
    assert.fail(`Unexpected fixture request ${url.pathname}`);
   });
   assert.equal(await syncHiringReplies(f.store,f.db,google,50,Date.now()+20000,b.bucket),1);
   const communication=f.database.prepare("SELECT body FROM hub_communications WHERE status='received'").get()!;
   if(scenario.startsWith("html")){assert.equal(communication.body,"Confirmed & ready.");assert.equal(String(communication.body).includes("alert"),false);}
   if(scenario==="external-body")assert.equal(communication.body,"Confirmed from external body.");
   if(["attachment","quarantine"].includes(scenario)){
    const file=f.database.prepare("SELECT * FROM hub_files").get()!;assert.equal(file.application_id,f.app.id);assert.deepEqual(b.objects.get(String(file.object_key))!.bytes,bytes);
    assert.equal(String(file.filename).endsWith(".quarantined"),scenario==="quarantine");assert.equal(b.puts(),1);
    assert.equal(file.content_type,scenario==="quarantine"?"application/octet-stream":"application/pdf");
   }
   assert.equal(await syncHiringReplies(f.store,f.db,google,50,Date.now()+20000,b.bucket),0);
   assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received'").get()!.n,1);
   assert.equal(messageRequests,1,"completed IDs skip repeated full-message requests");
   assert.equal(attachmentRequests,scenario.startsWith("html")?0:1);
   assert.equal(await f.store.setting("mail_sync_last_error",""),"");
  }finally{f.database.close();}
 });
}
test("previous blank imports and temporary R2 failures repair without losing or duplicating replies",async()=>{
 const f=await fixture(),b=bucketFixture();const pdf=new TextEncoder().encode(samplePdf());let history=0;
 try{
  const now=Date.now(),task=`gmail-import:${sender}:reply`;
  await f.db.batch([f.store.taskStatement(task,f.app.id,"gmail",{messageId:"<reply@example.invalid>",deliveryAccount:sender},now),f.db.prepare("INSERT INTO hub_communications(id,application_id,task_id,subject,body,status,provider_id,thread_id,created_at,updated_at) VALUES(?,?,?,'Synthetic','','received','reply','linked',?,?)").bind("old-import",f.app.id,task,now,now)]);
  const google=workspace(async(input)=>{const url=new URL(String(input));if(url.hostname==="oauth2.googleapis.com")return response({access_token:"synthetic",token_type:"Bearer",expires_in:3600});if(url.pathname.endsWith("/profile"))return response({emailAddress:sender,historyId:"100"});if(url.pathname.endsWith("/history"))return response({historyId:"101",history:history++?[]:[{messagesAdded:[{message:{id:"reply",threadId:"linked"}}]}]});if(url.pathname.endsWith("/messages/reply"))return response({id:"reply",threadId:"linked",payload:{mimeType:"multipart/mixed",headers:f.headers,parts:[{mimeType:"text/html",body:{data:Buffer.from("<p>My repaired answer.</p>").toString("base64url")}},{partId:"2",filename:"portfolio.pdf",mimeType:"application/pdf",body:{attachmentId:"file",size:pdf.length}}]}});if(url.pathname.endsWith("/attachments/file"))return response({data:Buffer.from(pdf).toString("base64url")});assert.fail(url.pathname);});
  b.setFail(true);assert.equal(await syncHiringReplies(f.store,f.db,google,50,Date.now()+20000,b.bucket),1);
  assert.match(String(f.database.prepare("SELECT body FROM hub_communications WHERE id='old-import'").get()!.body),/My repaired answer.*\n.*incomplete/);
  assert.match(await f.store.setting("mail_sync_last_error",""),/need repair/);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_files").get()!.n,0);
  b.setFail(false);await f.store.setSetting(`gmail_message_next_repair:${sender}:reply`,0);
  assert.equal(await syncHiringReplies(f.store,f.db,google,50,Date.now()+20000,b.bucket),1);
  assert.equal(f.database.prepare("SELECT body FROM hub_communications WHERE id='old-import'").get()!.body,"My repaired answer.");
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_files").get()!.n,1);assert.equal(b.puts(),1);assert.equal(await f.store.setting("mail_sync_last_error",""),"");
 }finally{f.database.close();}
});
test("delta pages checkpoint every message and never advance over a partial page",async()=>{
 const f=await fixture();let historyCalls=0;const params:string[]=[];
 try{
  const google=workspace(async(input)=>{const url=new URL(String(input));if(url.hostname==="oauth2.googleapis.com")return response({access_token:"synthetic",token_type:"Bearer",expires_in:3600});if(url.pathname.endsWith("/profile"))return response({emailAddress:sender,historyId:"100"});if(url.pathname.endsWith("/history")){historyCalls++;params.push(url.search);const second=url.searchParams.get("pageToken")==="next";return response({historyId:second?"120":"110",nextPageToken:second?undefined:"next",history:[{messagesAdded:(second?["r4"]:["r1","r2","r3"]).map(id=>({message:{id,threadId:"linked"}}))}]});}if(url.pathname.includes("/messages/")){const id=url.pathname.split("/").at(-1)!;return response({id,threadId:"linked",payload:{mimeType:"text/plain",headers:f.headers,body:{data:Buffer.from(id).toString("base64url")}}});}assert.fail(url.pathname);});
  await syncHiringReplies(f.store,f.db,google,1);assert.equal((await f.store.setting<DeltaState>("gmail_delta_state_v1",{historyId:""})).historyId,"100");
  await syncHiringReplies(f.store,f.db,google,1);assert.equal(historyCalls,1);
  await syncHiringReplies(f.store,f.db,google,1);assert.equal((await f.store.setting<DeltaState>("gmail_delta_state_v1",{historyId:""})).pageToken,"next");
  await syncHiringReplies(f.store,f.db,google,1);assert.equal((await f.store.setting<DeltaState>("gmail_delta_state_v1",{historyId:""})).historyId,"120");assert.equal(historyCalls,2);assert.match(params[1],/startHistoryId=100/);assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received'").get()!.n,4);
 }finally{f.database.close();}
});
test("3000 already caught-up threads need one delta page, not a 300-wakeup sweep",async()=>{
 const f=await fixture();let historyCalls=0,threadCalls=0;
 try{
  const now=Date.now(),task=f.database.prepare("INSERT INTO hub_tasks(id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) VALUES(?,?,'gmail',?,'done',0,?,?,?)"),comm=f.database.prepare("INSERT INTO hub_communications(id,application_id,task_id,subject,body,status,provider_id,thread_id,created_at,updated_at) VALUES(?,?,?,'Synthetic','Synthetic','sent',?,?,?,?)"),marker=f.database.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,'true',?)");
  f.database.exec("BEGIN");for(let n=0;n<3000;n++){const id=`task${n}`,thread=`thread${n}`;task.run(id,f.app.id,JSON.stringify({messageId:`<${n}@example.invalid>`,deliveryAccount:sender}),now,now,now);comm.run(`comm${n}`,f.app.id,id,`out${n}`,thread,now,now);marker.run(`gmail_thread_caught_up:${sender}:test:${thread}`,now);}f.database.exec("COMMIT");
  const google={async profile(){return{email:sender,historyId:"101"};},async mailHistory(){historyCalls++;return{historyId:"101",messages:[{id:"new-reply",threadId:"thread2999"}]};},async mailMessage(id:string){return{id,threadId:"thread2999",messageId:"<new@example.invalid>",inReplyTo:"<2999@example.invalid>",references:"",from:"synthetic@example.invalid",subject:"Reply",body:"Current reply",sent:false,createdAt:now,attachments:[]};},async threadMessages(){threadCalls++;return[];}} as unknown as GoogleWorkspace;
  assert.equal(await syncHiringReplies(f.store,f.db,google),1);assert.equal(historyCalls,1);assert.equal(threadCalls,0);assert.equal((await f.store.setting<DeltaState>("gmail_delta_state_v1",{historyId:""})).historyId,"101");
 }finally{f.database.close();}
});
test("a reply seen before delivery linking is caught up after the thread becomes known",async()=>{
 const f=await fixture();let threadCalls=0;
 try{
  const message={id:"early",threadId:"earlier-than-bootstrap",messageId:"<early@example.invalid>",inReplyTo:f.reference,references:"",from:"synthetic@example.invalid",subject:"Reply",body:"Arrived during uncertain send",sent:false,createdAt:Date.now(),attachments:[]};
  const google={async profile(){return{email:sender,historyId:"101"};},async mailHistory(){return{historyId:"101",messages:[{id:message.id,threadId:message.threadId}]};},async mailMessage(){return message;},async threadMessages(){threadCalls++;return[message];}} as unknown as GoogleWorkspace;
  assert.equal(await syncHiringReplies(f.store,f.db,google),0);
  f.database.prepare("UPDATE hub_communications SET thread_id=? WHERE status='sent'").run(message.threadId);
  assert.equal(await syncHiringReplies(f.store,f.db,google),1);assert.equal(threadCalls,1);assert.equal(f.database.prepare("SELECT body FROM hub_communications WHERE status='received'").get()!.body,message.body);
 }finally{f.database.close();}
});
test("a reply to imported manual outbound mail selects the exact application in a shared thread",async()=>{
 const f=await fixture();let page=0;
 try {
  const other=await f.store.acceptApplication({jobPostingId:f.role.id,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]},"a".repeat(64));
  f.database.prepare("UPDATE hub_communications SET status='sent',provider_id='original-B',thread_id='linked' WHERE application_id=?").run(other.id);
  const messages={external:{id:"external",threadId:"linked",messageId:"<external@example.invalid>",inReplyTo:f.reference,references:"",from:sender,subject:"Manual follow-up",body:"Question for the first application",sent:true,createdAt:Date.now(),attachments:[]},reply:{id:"reply",threadId:"linked",messageId:"<manual-reply@example.invalid>",inReplyTo:"<external@example.invalid>",references:"",from:"synthetic@example.invalid",subject:"Reply",body:"Answer for the first application",sent:false,createdAt:Date.now()+1,attachments:[]}};
  const google={async profile(){return{email:sender,historyId:"102"};},async mailHistory(){const first=page++===0;return{historyId:first?"101":"102",messages:[{id:first?"external":"reply",threadId:"linked"}]};},async mailMessage(id:"external"|"reply"){return messages[id];},async threadMessages(){return[];}} as unknown as GoogleWorkspace;
  assert.equal(await syncHiringReplies(f.store,f.db,google),1);
  assert.equal(f.database.prepare("SELECT application_id FROM hub_communications WHERE status='sent_external'").get()!.application_id,f.app.id);
  assert.equal(await syncHiringReplies(f.store,f.db,google),1);
  const received=f.database.prepare("SELECT application_id,body FROM hub_communications WHERE status='received'").all();
  assert.equal(received.length,1);assert.equal(received[0].application_id,f.app.id);assert.equal(received[0].body,messages.reply.body);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received' AND application_id=?").get(other.id)!.n,0);
 }finally{f.database.close();}
});
test("concurrent mailbox polls hold a lease and cannot overwrite the cursor",async()=>{
 const f=await fixture();let calls=0,release!:()=>void,entered!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
 try{
  const google={async profile(){return{email:sender,historyId:"101"};},async mailHistory(){calls++;entered();await hold;return{historyId:"101",messages:[]};},async threadMessages(){return[];}} as unknown as GoogleWorkspace;
  const first=syncHiringReplies(f.store,f.db,google);await ready;assert.equal(await syncHiringReplies(f.store,f.db,google),0);release();await first;assert.equal(calls,1);assert.equal((await f.store.setting<DeltaState>("gmail_delta_state_v1",{historyId:""})).historyId,"101");
 }finally{release();f.database.close();}
});
for (const status of [404, 403, 503]) {
 test(`a discovered message read ${status} ${status===404?"checkpoints a deleted message without starving later replies":"retains the reference for retry"}`,async()=>{
  const f=await fixture();let messageCalls=0;
  try {
   const google={async profile(){return{email:sender,historyId:"102"};},async mailHistory(){return{historyId:"102",messages:[{id:"missing",threadId:"linked"},{id:"later",threadId:"linked"}]};},async mailMessage(id:string){messageCalls++;if(id==="missing")throw new GoogleError("google_api_error",status);return{id,threadId:"linked",messageId:"<later@example.invalid>",inReplyTo:f.reference,references:"",from:"synthetic@example.invalid",subject:"Reply",body:"Later reply survives",sent:false,createdAt:Date.now(),attachments:[]};},async threadMessages(){return[];}} as unknown as GoogleWorkspace;
   const imported=await syncHiringReplies(f.store,f.db,google);
   const state=await f.store.setting<DeltaState&{pending?:Array<{id:string}>}>("gmail_delta_state_v1",{historyId:""});
   if(status===404){
    assert.equal(imported,1);assert.equal(state.historyId,"102");assert.equal(state.pending,undefined);
    const observation=await f.store.setting<{applicationIds:string[]}|null>(`gmail_message_missing:${sender}:missing`,null);assert.deepEqual(observation?.applicationIds,[f.app.id]);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM hub_communications WHERE status='received'").get()!.n,1);
    assert.equal(f.database.prepare("SELECT body FROM hub_communications WHERE status='received'").get()!.body,"Later reply survives");
    assert.equal(await f.store.setting("mail_sync_last_error",""),"");
   }else{
    assert.equal(imported,0);assert.equal(state.historyId,"100");assert.deepEqual(state.pending?.map(message=>message.id),["missing","later"]);
    assert.equal(await f.store.setting(`gmail_message_missing:${sender}:missing`,null),null);assert.match(await f.store.setting("mail_sync_last_error",""),/needs attention/);
   }
   await syncHiringReplies(f.store,f.db,google);
   assert.equal(messageCalls,status===404?2:2,"deleted observations skip repeat reads; temporary or permission failures retry the same head");
  }finally{f.database.close();}
 });
}
test("expired history cursor starts bounded catch-up and retains old replies",async()=>{
 const f=await fixture();
 try{
  const google={async profile(){return{email:sender,historyId:"200"};},async mailHistory(){throw new GoogleError("google_api_error",404);},async threadMessages(){return[{id:"old",threadId:"linked",messageId:"<old@example.invalid>",inReplyTo:f.reference,references:"",from:"synthetic@example.invalid",subject:"Reply",body:"Recovered old reply",sent:false,createdAt:Date.now(),attachments:[]}];}} as unknown as GoogleWorkspace;
  assert.equal(await syncHiringReplies(f.store,f.db,google),1);assert.equal((await f.store.setting<DeltaState>("gmail_delta_state_v1",{historyId:""})).historyId,"200");assert.equal(f.database.prepare("SELECT body FROM hub_communications WHERE status='received'").get()!.body,"Recovered old reply");
 }finally{f.database.close();}
});
test("cancellation contacts the original calendar despite a changed global default",async()=>{
 const f=await fixture();const id="old-booking",providerId=await calendarEventId(id),paths:string[]=[];
 try{
  f.database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");
  await f.db.prepare("INSERT INTO hub_interviews(id,application_id,status,calendar_id,provider_id,revision,created_at,updated_at) VALUES(?,?,'cancel_pending','old-calendar',?,2,?,?)").bind(id,f.app.id,providerId,Date.now(),Date.now()).run();
  await f.store.taskStatement("cancel-old",f.app.id,"calendar",{operation:"cancel",interviewId:id,id:providerId,revision:2},Date.now()).run();
  const google=new GoogleWorkspace({clientId:"synthetic",clientSecret:"synthetic",refreshToken:"synthetic",sender,calendarId:"new-calendar"},async(input,init={})=>{const url=new URL(String(input));paths.push(url.pathname);if(url.hostname==="oauth2.googleapis.com")return response({access_token:"synthetic",token_type:"Bearer",expires_in:3600});assert.ok(url.pathname.includes("/old-calendar/"));return init.method==="DELETE"?new Response(null,{status:204}):response({id:providerId,etag:"etag",status:"confirmed",extendedProperties:{private:{aclInterviewId:providerId}}});});
  google.archiveApplication=async()=>({folderId:"synthetic",folderUrl:"https://drive.google.com/synthetic",archivedRevision:1});
  await processHubTasks(f.store,f.db,{} as R2Bucket,google,1);assert.equal(f.database.prepare("SELECT status FROM hub_interviews").get()!.status,"cancelled");assert.equal(paths.filter(path=>path.includes("/old-calendar/")).length,2);assert.ok(!paths.some(path=>path.includes("/new-calendar/")));
 }finally{f.database.close();}
});
test("shared reconciliation deadline stops before processing all slow reads",async()=>{
 const f=await fixture(),original=Date.now;let clock=original(),calls=0;
 try{
  f.database.exec("DELETE FROM hub_communications; DELETE FROM hub_tasks");for(let n=0;n<5;n++)await f.store.taskStatement(`uncertain${n}`,f.app.id,"gmail",{messageId:`<${n}@example.invalid>`,deliveryAccount:"mariam@aicaseleads.com"},clock).run();f.database.exec("UPDATE hub_tasks SET status='uncertain'");
  Date.now=()=>clock;
  const google={async reconcileMail(){calls++;clock+=20000;return null;},async threadMessages(){return[];}} as unknown as GoogleWorkspace;
  await processHubTasks(f.store,f.db,{} as R2Bucket,google,5,[],async()=>google);assert.equal(calls,2);assert.equal(clock-original()<41000,true);const health=await f.store.setting<{error:string;uncertain:number}>("worker_health",{error:"",uncertain:0});assert.match(health.error,/attention/);assert.equal(health.uncertain,5);
 }finally{Date.now=original;f.database.close();}
});
test("expired budgets prevent new Google requests and over-budget retry sleeps",async()=>{
 let requests=0,waits=0;const google=workspace(async()=>{requests++;assert.fail("must not start expired operation");});google.setDeadline(Date.now()-1);await assert.rejects(()=>google.sendMail({to:"candidate@example.invalid",subject:"Synthetic",body:"Synthetic",messageId:"synthetic@example.invalid"}),{code:"processor_deadline_exceeded"});assert.equal(requests,0);
 await assert.rejects(()=>providerRequest("https://www.googleapis.com/synthetic",{},"google_drive",async()=>{requests++;return new Response(null,{status:429,headers:{"Retry-After":"10"}});},async()=>{waits++;},()=>Date.now()+5000),{code:"deadline_exceeded"});assert.equal(requests,1);assert.equal(waits,0);
});

test("mail sync excludes legacy sales and other recruiter links, catchup and repair",async()=>{
 const f=await fixture();try{
  const now=Date.now();
  for(const [label,account] of [["sales","sales@aicaseleads.com"],["other","other@example.invalid"],["legacy",null]]){
   for(const status of ["sent","received"]){
    const id=`foreign-${label}-${status}`,payload={messageId:`<${id}@example.invalid>`,...(account?{deliveryAccount:account}:{})};
    await f.db.batch([f.store.taskStatement(id,f.app.id,"gmail",payload,now),f.db.prepare("INSERT INTO hub_communications(id,application_id,task_id,subject,body,status,provider_id,thread_id,created_at,updated_at) VALUES(?,?,?,'Foreign','',?,?,?,?,?)").bind(id,f.app.id,id,status,id,`thread-${label}`,now,now)]);
   }
  }
  await f.store.setSetting("gmail_message_complete:sales@aicaseleads.com:reply",1);
  await f.store.setSetting("gmail_message_error:sales@aicaseleads.com:old","old sales error");
  const reads:string[]=[];
  const google={async profile(){return{email:sender,historyId:"100"};},async mailHistory(){return{historyId:"101",messages:[{id:"foreign-sales-sent",threadId:"thread-sales"},{id:"foreign-other-sent",threadId:"thread-other"},{id:"foreign-legacy-sent",threadId:"thread-legacy"},{id:"reply",threadId:"linked"}]};},async mailMessage(id:string){reads.push(id);return{id,threadId:"linked",messageId:"<reply@example.invalid>",from:"synthetic@example.invalid",subject:"Current",body:"Current recruiter reply",sent:false,createdAt:now,inReplyTo:f.reference,references:f.reference,attachments:[]};},async threadMessages(id:string){assert.fail(`Must not fetch foreign catchup thread ${id}`);}} as unknown as GoogleWorkspace;
  assert.equal(await syncHiringReplies(f.store,f.db,google),1);
  assert.deepEqual(reads,["reply"]);
  assert.equal(await f.store.setting(`gmail_message_complete:${sender}:reply`,0),1);
  assert.equal(await f.store.setting("mail_sync_last_error",""),"");
  const row=f.database.prepare("SELECT t.payload_json FROM hub_tasks t WHERE t.id=?").get(`gmail-import:${sender}:reply`)!;
  assert.equal(JSON.parse(String(row.payload_json)).deliveryAccount,sender);
 }finally{f.database.close();}
});
