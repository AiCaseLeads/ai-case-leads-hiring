import test from "node:test";
test("a four-byte pretend DOCX is rejected before storage; a real OOXML resume is accepted",async()=>{
 const {database,db,store}=customDatabase();try{
  const job=await openSyntheticRole(store);await store.saveJob({...job,fields:[...job.fields,{path:"resume",title:"Resume",type:"File",required:true}]},job.id);
  const provider=new LocalHiringProvider(db,session,origin);let puts=0;const bucket={async put(){puts++;}} as unknown as R2Bucket;
  for(const [bytes,expected] of [[new Uint8Array([0x50,0x4b,3,4]),422],[sampleDocx(),204]] as const){
   const upload=await provider.createUpload({jobPostingId:job.id,fieldPath:"resume",filename:"resume.docx",contentType:DOCX_MIME,contentLength:bytes.length});
   const form=new FormData();form.append("file",new File([bytes],"resume.docx",{type:DOCX_MIME}));
   const req=new Request(origin+"/api/uploads/test",{method:"POST",headers:{Origin:origin,Cookie:"hiring_session="+session},body:form});
   assert.equal((await receiveUpload(req,upload.handle,db,bucket,true)).status,expected);
  }
  assert.equal(puts,1);
 }finally{database.close();}
});
import assert from "node:assert/strict";
import { customDatabase,openSyntheticRole } from "./custom-fixture";
import { LocalHiringProvider,acceptLocalApplication } from "../lib/hiring/local";
import { receiveUpload } from "../lib/hiring/files";
import { sha256 } from "../lib/hiring/crypto";
import { samplePdf, sampleDocx, DOCX_MIME } from "./document-fixture";
const origin="https://careers.invalid",session="a".repeat(64);
function request(bytes=samplePdf(),cookie=session){const form=new FormData();form.append("file",new File([bytes],"resume.pdf",{type:"application/pdf"}));return new Request(origin+"/api/uploads/test",{method:"POST",headers:{Origin:origin,Cookie:`hiring_session=${cookie}`},body:form});}
async function setup(){const setup=customDatabase(),job=await openSyntheticRole(setup.store);await setup.store.saveJob({...job,fields:[...job.fields,{path:"resume",title:"Resume",type:"File",required:true}]},job.id);const provider=new LocalHiringProvider(setup.db,session,origin);const upload=await provider.createUpload({jobPostingId:job.id,fieldPath:"resume",filename:"resume.pdf",contentType:"application/pdf",contentLength:Buffer.byteLength(samplePdf())});return {...setup,job,upload};}
test("private uploads verify bytes and ownership; repeated concurrent posts cannot overwrite a resume",async()=>{
  const {database,db,job,upload}=await setup();try{
    let puts=0;const bucket={async put(){puts++;}} as unknown as R2Bucket;
    assert.equal((await receiveUpload(request(samplePdf(),"b".repeat(64)),upload.handle,db,bucket,true)).status,410);
    const responses=await Promise.all([receiveUpload(request(),upload.handle,db,bucket,true),receiveUpload(request(),upload.handle,db,bucket,true)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[204,409]);assert.equal(puts,1);
    const result=await acceptLocalApplication(db,{jobPostingId:job.id,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic"},{path:"_systemfield_email",value:"synthetic@example.invalid"},{path:"resume",value:upload.handle}]},session,true);
    assert.equal(result.status,"accepted");
    const row=await db.prepare("SELECT id,application_id FROM hub_files WHERE id=?").bind(await sha256(upload.handle)).first<{id:string;application_id:string}>();assert.ok(row?.application_id);
    assert.equal((await receiveUpload(request(),upload.handle,db,bucket,true)).status,410);
  }finally{database.close();}
});
test("expired links and fake PDF bytes cannot create objects; storage outage permits a safe retry",async()=>{
  const {database,db,upload}=await setup();try{
    let puts=0;const bucket={async put(){puts++;throw new Error("synthetic R2 outage");}} as unknown as R2Bucket;
    assert.equal((await receiveUpload(request("<html>BAD"),upload.handle,db,bucket,true)).status,422);assert.equal(puts,0);
    assert.equal((await receiveUpload(request(),upload.handle,db,bucket,true)).status,503);assert.equal(puts,1);
    assert.equal((await db.prepare("SELECT uploaded_at FROM hub_files WHERE id=?").bind(await sha256(upload.handle)).first<{uploaded_at:number|null}>())?.uploaded_at,null);
    await db.prepare("UPDATE hub_files SET expires_at=0 WHERE id=?").bind(await sha256(upload.handle)).run();
    assert.equal((await receiveUpload(request(),upload.handle,db,bucket,true)).status,410);assert.equal(puts,1);
  }finally{database.close();}
});
