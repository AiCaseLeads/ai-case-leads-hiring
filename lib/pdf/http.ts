import { z } from "zod";
import type { HubMember } from "../hub/auth-core";
import type { HubStore } from "../hub/store";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { withinDeadline, DeadlineError } from "../hiring/deadline";
import { parse } from "../hub/validation";
import { extractPdf,pdfResult } from "./extract";
import { MAX_PDF_BYTES,type PdfResult,type ResumeText } from "./types";
import { readCachedFileTexts,RESUME_TEXT_VERSION } from "../resume-text/cache";
const inputSchema=z.object({applicationId:z.string().min(1).max(128),fileId:z.string().regex(/^(?:gmail-)?[a-f0-9]{64}$/)}).strict();
export type PdfDependencies={store:HubStore;bucket?:R2Bucket;extract?:(bytes:Uint8Array)=>Promise<PdfResult>;storageTimeoutMs?:number};
const inFlight=new Map<string,Promise<ResumeText>>();
export async function readResumeText(applicationId:string,fileId:string,deps:PdfDependencies):Promise<ResumeText>{
  // Join guarantees the file is a completed original attached to this application.
  const file=await deps.store.stmt("SELECT id,filename,content_type,object_key,size,uploaded_at FROM hub_files WHERE id=? AND application_id=? AND uploaded_at>0",fileId,applicationId).first<{id:string;filename:string;content_type:string;object_key:string;size:number;uploaded_at:number}>();
  if(!file)throw new HiringError("file_not_found",404,"This file does not belong to this application or is unavailable.");
  if(file.content_type!=="application/pdf")throw new HiringError("pdf_required",422,"Choose an uploaded PDF. Other files remain available for manual review.");
  const full=(await readCachedFileTexts(deps.store,[file])).get(file.id)!;
  if(!['pending','running','failed'].includes(full.status))return {...pdfResult(full.status as PdfResult['status'],full.text.slice(0,30000),full.pages,full.truncated||full.text.length>30000,full.ocrPages,full.ocrIncomplete),fileId:file.id,filename:file.filename,cached:true};
  // Version 2 retries scans previously cached as no_text before local OCR existed.
  const key=`pdf_text_v2_${file.id}_${file.uploaded_at}_${file.size}`;
  const cached=await deps.store.setting<PdfResult|null>(key,null);
  const wrap=(data:PdfResult,cached=false):ResumeText=>({...data,fileId:file.id,filename:file.filename,cached});
  if(cached)return wrap(cached,true);
  const queued=await deps.store.stmt("SELECT 1 FROM hub_file_text WHERE file_id=? AND uploaded_at=? AND size=? AND content_type=? AND parser_version=?",file.id,file.uploaded_at,file.size,file.content_type,RESUME_TEXT_VERSION).first();
  if(queued)throw new HiringError(full.status==='failed'?'pdf_unavailable':'pdf_busy',503,full.status==='failed'?'Résumé text could not be read. Open the original for manual review.':'Résumé text is being prepared. Retry shortly.');
  if(file.size>MAX_PDF_BYTES)return wrap(pdfResult("too_large"));
  if(!deps.bucket)throw new HiringError("storage_unavailable",503,"Private file storage is unavailable. Please retry shortly.");
  if(inFlight.has(key))return inFlight.get(key)!;
  // Limit pending reads too: no thousand-file memory queue ahead of the process cap.
  if(inFlight.size>=1)throw new HiringError("pdf_busy",429,"A PDF is being read. Retry in a moment; applications can still be submitted.");
  const pending=(async()=>{
    const deadline=Date.now()+Math.max(1,Math.min(deps.storageTimeoutMs??5000,5000));
    const object=await withinDeadline(()=>deps.bucket!.get(file.object_key),deadline,"pdf_storage_timeout");
    if(!object)throw new HiringError("file_not_found",404,"The original file is temporarily unavailable.");
    if(object.size!==file.size||object.size>MAX_PDF_BYTES||object.customMetadata?.fileId!==file.id){void object.body.cancel().catch(()=>undefined);throw new HiringError("file_invalid",422,"The stored PDF does not match its upload record.");}
    const reader=object.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try {
      while(true){
        const {done,value}=await withinDeadline(()=>reader.read(),deadline,"pdf_storage_timeout");if(done)break;
        length+=value.byteLength;
        if(length>MAX_PDF_BYTES)throw new HiringError("file_invalid",422,"The stored PDF exceeds its upload limit.");
        chunks.push(value);
      }
    }catch(error){void reader.cancel().catch(()=>undefined);throw error;}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(bytes.length!==file.size)throw new HiringError("file_invalid",422,"The stored PDF is incomplete.");
    const data=await (deps.extract||extractPdf)(bytes);
    if(!["timeout","unavailable"].includes(data.status)&&!data.ocrIncomplete)await deps.store.setSetting(key,data);
    return wrap(data);
  })();
  inFlight.set(key,pending);
  try{return await pending;}
  catch(error){if(error instanceof DeadlineError)throw new HiringError("pdf_storage_timeout",503,"Reading the private file took too long. Please retry; the original is unchanged.");throw error;}
  finally{inFlight.delete(key);}
}
export async function handleResumeText(request:Request,member:HubMember|null,deps:PdfDependencies):Promise<Response>{
  try {
    if(!member||!["admin","recruiter"].includes(member.role))throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring team account.");
    if(request.method!=="POST")throw new HiringError("method_not_allowed",405,"Use the PDF preview to read an uploaded file.");
    assertSameOrigin(request);
    let raw:unknown;
    try{raw=JSON.parse(new TextDecoder().decode(await boundedBytes(request,4096)));}catch(error){if(error instanceof HiringError)throw error;throw new HiringError("invalid_request",400,"The request could not be read.");}
    const input=parse(inputSchema,raw);
    return jsonResponse({data:await readResumeText(input.applicationId,input.fileId,deps)});
  }catch(error){return errorResponse(error);}
}
