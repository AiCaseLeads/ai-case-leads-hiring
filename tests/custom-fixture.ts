import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { HubStore } from "../lib/hub/store";
export function customDatabase(){
  const database=new DatabaseSync(":memory:");
  const folder=new URL("../drizzle/",import.meta.url);
  const journal=JSON.parse(readFileSync(new URL("meta/_journal.json",folder),"utf8")) as {entries:{tag:string}[]};
  for(const {tag} of journal.entries)database.exec(readFileSync(new URL(tag+".sql",folder),"utf8"));
  const db={
    prepare(sql:string){
      const stmt=database.prepare(sql);let values:(string|number|null)[]=[];
      const prepared={bind(...args:(string|number|null)[]){values=args;return prepared;},
        runSync(){const result=stmt.run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
        async run(){return prepared.runSync();},async first(){return stmt.get(...values)||null;},async all(){return {success:true,results:stmt.all(...values)};}};
      return prepared;
    },
    async batch(statements:{runSync():unknown}[]){database.exec("BEGIN");try{const result=statements.map(stmt=>stmt.runSync());database.exec("COMMIT");return result;}catch(error){database.exec("ROLLBACK");throw error;}}
  } as unknown as D1Database;
  return {database,db,store:new HubStore(db)};
}
export async function openSyntheticRole(store:HubStore){
  return store.saveJob({title:"Synthetic Full-stack Engineer",slug:"synthetic-full-stack-engineer",department:"Test",descriptionHtml:"<p>Isolated synthetic test only.</p>",status:"open",fields:[{path:"_systemfield_name",title:"Name",type:"String",required:true},{path:"_systemfield_email",title:"Email",type:"Email",required:true}],rules:[],autoReject:false,rejectionTemplate:"Thank you, {{name}}. We are not moving forward with your application.",assessmentPrompt:"Describe an approach to a synthetic test problem."});
}

/** Real private upload validation with an isolated in-memory object sink. */
export async function uploadSyntheticResume(db:D1Database,jobId:string,session:string){
  const {LocalHiringProvider}=await import("../lib/hiring/local");
  const {receiveUpload}=await import("../lib/hiring/files");
  const {samplePdf}=await import("./document-fixture");
  const origin="https://careers.invalid",bytes=samplePdf();
  const upload=await new LocalHiringProvider(db,session,origin).createUpload({jobPostingId:jobId,fieldPath:"_systemfield_resume",filename:"synthetic-resume.pdf",contentType:"application/pdf",contentLength:Buffer.byteLength(bytes)});
  const body=new FormData();body.append("file",new File([bytes],"synthetic-resume.pdf",{type:"application/pdf"}));
  const result=await receiveUpload(new Request(origin+"/api/uploads/"+upload.handle,{method:"POST",headers:{Origin:origin,Cookie:"hiring_session="+session},body}),upload.handle,db,{async put(){}} as unknown as R2Bucket,true);
  if(result.status!==204)throw new Error("synthetic_resume_upload_failed:"+result.status);
  return {path:"_systemfield_resume",value:upload.handle};
}
