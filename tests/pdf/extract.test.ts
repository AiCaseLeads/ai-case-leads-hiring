import assert from "node:assert/strict";
import test from "node:test";
import {extractPdf,pdfResult} from "../../lib/pdf/extract";
import {handleResumeText,readResumeText} from "../../lib/pdf/http";
import {MAX_PDF_BYTES} from "../../lib/pdf/types";
import {createStore,MANAGER,RECRUITER,jobInput,applicationInput} from "../hub/fixtures";
import {makePdf} from "./fixtures";
const origin="https://jobs.example.invalid";
const req=(body:unknown,source=origin)=>new Request(origin+"/api/ai/resume-text",{method:"POST",headers:{"content-type":"application/json",origin:source},body:JSON.stringify(body)});
async function fixture(){
  const f=createStore(),job=await f.store.saveJob(jobInput());
  const app=await f.store.acceptApplication(applicationInput(job.id));
  const bytes=makePdf(),fileId=crypto.randomUUID().replaceAll("-","").repeat(2);
  await f.store.stmt("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",fileId,job.id,"resume","resume.pdf","application/pdf",bytes.length,`private/${fileId}`,Date.now(),app.id,Date.now()+100000,"a".repeat(64)).run();
  let reads=0,calls=0;
  const bucket={get:async()=>{reads++;return {size:bytes.length,customMetadata:{fileId},body:new Response(bytes.buffer as ArrayBuffer).body!};}} as unknown as R2Bucket;
  const deps={store:f.store,bucket,extract:async()=>{calls++;return pdfResult("ready","Built React applications for two years.",1);}};
  return {...f,deps,fileId,applicationId:app.id,counts:()=>({reads,calls})};
}
test("real isolated parser reads PDF text, identifies scans, password protection, invalid and page limits",async()=>{
  const parsed=await extractPdf(makePdf());assert.equal(parsed.status,"ready",JSON.stringify(parsed));assert.match(parsed.text,/Built React applications/);assert.equal(parsed.pages,1);assert.equal(parsed.truncated,false);
  assert.equal((await extractPdf(makePdf(""))).status,"no_text");
  assert.equal((await extractPdf(makePdf("secret",1,true))).status,"password_protected");
  assert.equal((await extractPdf(makePdf("experience",31))).status,"too_many_pages");
  assert.equal((await extractPdf(new TextEncoder().encode("%PDF-1.4\ninvalid"))).status,"invalid");
  assert.equal((await extractPdf(new Uint8Array(MAX_PDF_BYTES+1))).status,"too_large");
});
test("real parser truncation is explicit and text length bounded",async()=>{
  const parsed=await extractPdf(makePdf("React experience ".repeat(100),30));
  assert.equal(parsed.status,"ready");assert.equal(parsed.truncated,true);assert.ok(parsed.text.length<=30000);
});
test("PDF endpoint requires team authorization, same origin and attached original file ownership",async()=>{
  const f=await fixture(),input={applicationId:f.applicationId,fileId:f.fileId};
  assert.equal((await handleResumeText(req(input),null,f.deps)).status,403);
  assert.equal((await handleResumeText(req(input,"https://evil.invalid"),MANAGER,f.deps)).status,403);
  assert.equal((await handleResumeText(req({...input,applicationId:"someone-else"}),MANAGER,f.deps)).status,404);
  assert.equal((await handleResumeText(req({...input,fileId:"https://evil.invalid/file.pdf"}),MANAGER,f.deps)).status,422);
  assert.deepEqual(f.counts(),{reads:0,calls:0});
  const result=await handleResumeText(req(input),RECRUITER,f.deps);assert.equal(result.status,200);assert.equal(result.headers.get("Cache-Control"),"no-store");
  assert.equal((await handleResumeText(req(input),MANAGER,f.deps)).status,200);assert.deepEqual(f.counts(),{reads:1,calls:1});
  await f.store.stmt("UPDATE hub_files SET application_id=NULL WHERE id=?",f.fileId).run();
  assert.equal((await handleResumeText(req(input),MANAGER,f.deps)).status,404);f.database.close();
});
test("concurrent reads reuse one extraction; failures do not poison retry or accepted applications",async()=>{
  const f=await fixture();let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);let calls=0;
  const deps={...f.deps,extract:async()=>{calls++;await hold;return pdfResult("timeout");}};
  const first=readResumeText(f.applicationId,f.fileId,deps),second=readResumeText(f.applicationId,f.fileId,deps);
  await new Promise(resolve=>setTimeout(resolve,10));release();assert.equal((await first).status,"timeout");assert.equal((await second).status,"timeout");assert.equal(calls,1);
  assert.equal((await readResumeText(f.applicationId,f.fileId,f.deps)).status,"ready");
  assert.equal((await f.store.getApplication(f.applicationId)).stage,"Application Review");f.database.close();
});
test("missing, unsupported and mismatched private files never reach parser",async()=>{
  const f=await fixture();const input={applicationId:f.applicationId,fileId:f.fileId};
  assert.equal((await handleResumeText(req(input),MANAGER,{...f.deps,bucket:undefined})).status,503);
  assert.equal((await handleResumeText(req(input),MANAGER,{...f.deps,bucket:{get:async()=>null} as unknown as R2Bucket})).status,404);
  assert.equal((await handleResumeText(req(input),MANAGER,{...f.deps,bucket:{get:async()=>({size:5,body:new Response("wrong").body})} as unknown as R2Bucket})).status,422);
  await f.store.stmt("UPDATE hub_files SET content_type='application/msword' WHERE id=?",f.fileId).run();
  assert.equal((await handleResumeText(req(input),MANAGER,f.deps)).status,422);assert.equal(f.counts().calls,0);f.database.close();
});
test("parser hard deadline terminates child and releases bounded capacity",async()=>{
  assert.equal((await extractPdf(makePdf(),1)).status,"timeout");
  const first=extractPdf(makePdf());
  await assert.rejects(extractPdf(makePdf()),error=>error instanceof Error&&"code" in error&&error.code==="pdf_busy");
  assert.equal((await first).status,"ready");assert.equal((await extractPdf(makePdf())).status,"ready");
});
test("one pending private read caps the queue without reading another file",async()=>{
  const first=await fixture(),second=await fixture(),third=await fixture();
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  const extract=async()=>{await held;return pdfResult("ready","Read safely.",1);};
  const one=readResumeText(first.applicationId,first.fileId,{...first.deps,extract});
  await new Promise(resolve=>setTimeout(resolve,10));
  await assert.rejects(readResumeText(third.applicationId,third.fileId,third.deps),error=>error instanceof Error&&"code" in error&&error.code==="pdf_busy");
  await assert.rejects(readResumeText(second.applicationId,second.fileId,second.deps),error=>error instanceof Error&&"code" in error&&error.code==="pdf_busy");
  assert.deepEqual(third.counts(),{reads:0,calls:0});assert.deepEqual(second.counts(),{reads:0,calls:0});release();await one;
  first.database.close();second.database.close();third.database.close();
});
test("private object identity must match attached file before parsing",async()=>{
  const f=await fixture();const bytes=makePdf();
  const deps={...f.deps,bucket:{get:async()=>({size:bytes.length,customMetadata:{fileId:"different-applicant"},body:new Response(bytes.buffer as ArrayBuffer).body!})} as unknown as R2Bucket};
  const result=await handleResumeText(req({applicationId:f.applicationId,fileId:f.fileId}),MANAGER,deps);
  assert.equal(result.status,422);assert.equal(f.counts().calls,0);f.database.close();
});
test("storage get and body stalls release capacity and allow a later successful retry",async()=>{
  const f=await fixture(),input={applicationId:f.applicationId,fileId:f.fileId};
  const blocked={...f.deps,storageTimeoutMs:5,bucket:{get:()=>new Promise(()=>{})} as unknown as R2Bucket};
  assert.equal((await handleResumeText(req(input),MANAGER,blocked)).status,503);
  let cancelled=false;
  const stalled={...f.deps,storageTimeoutMs:5,bucket:{get:async()=>({size:makePdf().length,customMetadata:{fileId:f.fileId},body:new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>{}),cancel(){cancelled=true;}})})} as unknown as R2Bucket};
  assert.equal((await handleResumeText(req(input),MANAGER,stalled)).status,503);assert.equal(cancelled,true);
  assert.equal((await handleResumeText(req(input),MANAGER,f.deps)).status,200);f.database.close();
});
test("safe imported Gmail PDF identity supports automatic preview and review schema",async()=>{
  const f=await fixture(),original=f.fileId,fileId=`gmail-${original}`,bytes=makePdf();
  await f.store.stmt("UPDATE hub_files SET id=? WHERE id=?",fileId,original).run();
  const deps={...f.deps,bucket:{get:async()=>({size:bytes.length,customMetadata:{fileId},body:new Response(bytes.buffer as ArrayBuffer).body!})} as unknown as R2Bucket};
  const result=await handleResumeText(req({applicationId:f.applicationId,fileId}),MANAGER,deps);assert.equal(result.status,200);
  const {reviewInput}=await import("../../lib/ai/review");
  assert.equal(reviewInput.safeParse({applicationId:f.applicationId,expectedRevision:1,resumeFileId:fileId,resumeText:"",linkedinText:"",jobCriteria:"React experience",consent:true}).success,true);
  f.database.close();
});
test("OCR cache version retries old no-text scans and never caches incomplete OCR",async()=>{
  const f=await fixture();const file=await f.store.stmt("SELECT uploaded_at,size FROM hub_files WHERE id=?",f.fileId).first<{uploaded_at:number;size:number}>();
  await f.store.setSetting(`pdf_text_v1_${f.fileId}_${file!.uploaded_at}_${file!.size}`,pdfResult("no_text"));
  const result=await readResumeText(f.applicationId,f.fileId,f.deps);assert.equal(result.status,"ready");assert.equal(result.cached,false);assert.equal(f.counts().calls,1);f.database.close();
  const partial=await fixture();let calls=0;
  const deps={...partial.deps,extract:async()=>{calls++;return pdfResult("ready","Some readable text",9,false,8,true);}};
  await readResumeText(partial.applicationId,partial.fileId,deps);await readResumeText(partial.applicationId,partial.fileId,deps);
  assert.equal(calls,2);partial.database.close();
});
