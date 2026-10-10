import { HiringError } from "./errors";
import { readSession, errorResponse } from "./http";
import { sha256 } from "./crypto";
import { MAX_FILE_BYTES } from "./validation";
import { documentStructure } from "./document-structure";

export function requestOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin || ![null,"same-origin","none"].includes(request.headers.get("sec-fetch-site"))) throw new HiringError("invalid_origin",403,"Open this website before uploading.");
}
export async function boundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") || 0)>maxBytes) throw new HiringError("request_too_large",413,"This request is too large.");
  if (!request.body) throw new HiringError("invalid_request",400,"This request is empty.");
  const reader=request.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>maxBytes){await reader.cancel();throw new HiringError("request_too_large",413,"This request is too large.");}chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export function fileSignature(bytes:Uint8Array,type:string):boolean {
  const starts=(values:number[])=>values.every((v,i)=>bytes[i]===v);
  switch(type){
    case "application/pdf":return new TextDecoder().decode(bytes.slice(0,5))==="%PDF-";
    case "application/msword":return starts([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":return starts([0x50,0x4b,0x03,0x04]);
    case "image/png":return starts([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    case "image/jpeg":return starts([0xff,0xd8,0xff]);
    case "image/webp":return new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
    case "text/plain":return !bytes.slice(0,4096).includes(0);
    default:return false;
  }
}
type FileRow={id:string;session_hash:string;job_id:string;filename:string;content_type:string;size:number;object_key:string;expires_at:number;uploaded_at:number|null;application_id:string|null};
export async function receiveUpload(request:Request,token:string,db?:D1Database,bucket?:R2Bucket,enabled=false):Promise<Response>{
  let row:FileRow|null=null;
  try{
    requestOrigin(request);
    if(!enabled||!db||!bucket)throw new HiringError("applications_disabled",503,"File uploads are currently paused.");
    if(!/^[a-f0-9]{64}$/.test(token))throw new HiringError("invalid_upload",404,"This upload link is unavailable.");
    const session=readSession(request);if(!session)throw new HiringError("session_required",403,"Refresh the application before uploading.");
    const id=await sha256(token),sessionHash=await sha256(session);
    row=await db.prepare("SELECT * FROM hub_files WHERE id=? AND session_hash=? AND expires_at>? AND application_id IS NULL").bind(id,sessionHash,Date.now()).first<FileRow>();
    if(!row)throw new HiringError("upload_expired",410,"This upload link expired. Select your file again.");
    if(row.uploaded_at!==null)throw new HiringError("upload_used",409,"This upload link has already been used. Select your file again.");
    if(!request.headers.get("content-type")?.startsWith("multipart/form-data;"))throw new HiringError("invalid_content_type",415,"This upload requires a file.");
    const raw=await boundedBytes(request,MAX_FILE_BYTES+65536);
    const parsed=await new Request(request.url,{method:"POST",headers:{"Content-Type":request.headers.get("content-type")!},body:raw.buffer as ArrayBuffer}).formData();
    const file=parsed.get("file");
    if(!(file instanceof File)||file.size!==row.size||file.type!==row.content_type||file.name!==row.filename)throw new HiringError("invalid_upload",422,"The file does not match the prepared upload. Select it again.");
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(!fileSignature(bytes,row.content_type)||!documentStructure(bytes,row.content_type))throw new HiringError("invalid_upload",422,"This file is not a valid supported document. Export it again or choose another file.");
    const claim=await db.prepare("UPDATE hub_files SET uploaded_at=-1 WHERE id=? AND uploaded_at IS NULL AND application_id IS NULL AND expires_at>? RETURNING id").bind(id,Date.now()).first();
    if(!claim)throw new HiringError("upload_used",409,"This upload link has already been used.");
    try{
      await bucket.put(row.object_key,bytes,{httpMetadata:{contentType:row.content_type},customMetadata:{fileId:id,jobId:row.job_id}});
      await db.prepare("UPDATE hub_files SET uploaded_at=? WHERE id=? AND uploaded_at=-1 AND application_id IS NULL").bind(Date.now(),id).run();
    }catch(error){await db.prepare("UPDATE hub_files SET uploaded_at=NULL WHERE id=? AND uploaded_at=-1 AND application_id IS NULL").bind(id).run().catch(()=>undefined);throw error;}
    return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  }catch(error){return errorResponse(error);}
}
