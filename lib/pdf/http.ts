import { z } from "zod";
import type { HubMember } from "../hub/auth-core";
import type { HubStore } from "../hub/store";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { parse } from "../hub/validation";
import { extractPdf,pdfResult } from "./extract";
import { MAX_PDF_BYTES,type PdfResult,type ResumeText } from "./types";
const inputSchema=z.object({applicationId:z.string().min(1).max(128),fileId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type PdfDependencies={store:HubStore;bucket?:R2Bucket;extract?:(bytes:Uint8Array)=>Promise<PdfResult>};
const inFlight=new Map<string,Promise<ResumeText>>();
export async function readResumeText(applicationId:string,fileId:string,deps:PdfDependencies):Promise<ResumeText>{
  // Join guarantees the file is a completed original attached to this application.
  const file=await deps.store.stmt("SELECT id,filename,content_type,object_key,size,uploaded_at FROM hub_files WHERE id=? AND application_id=? AND uploaded_at>0",fileId,applicationId).first<{id:string;filename:string;content_type:string;object_key:string;size:number;uploaded_at:number}>();
  if(!file)throw new HiringError("file_not_found",404,"This file does not belong to this application or is unavailable.");
  if(file.content_type!=="application/pdf")throw new HiringError("pdf_required",422,"Choose an uploaded PDF. Other files remain available for manual review.");
  const key=`pdf_text_v1_${file.id}_${file.uploaded_at}_${file.size}`;
  const cached=await deps.store.setting<PdfResult|null>(key,null);
  const wrap=(data:PdfResult,cached=false):ResumeText=>({...data,fileId:file.id,filename:file.filename,cached});
  if(cached)return wrap(cached,true);
  if(file.size>MAX_PDF_BYTES)return wrap(pdfResult("too_large"));
  if(!deps.bucket)throw new HiringError("storage_unavailable",503,"Private file storage is unavailable. Please retry shortly.");
  if(inFlight.has(key))return inFlight.get(key)!;
  // Limit pending reads too: no thousand-file memory queue ahead of the process cap.
  if(inFlight.size>=2)throw new HiringError("pdf_busy",429,"Two PDFs are being read. Retry in a moment; applications can still be submitted.");
  const pending=(async()=>{
    const object=await deps.bucket!.get(file.object_key);
    if(!object)throw new HiringError("file_not_found",404,"The original file is temporarily unavailable.");
    if(object.size!==file.size||object.size>MAX_PDF_BYTES){await object.body.cancel();throw new HiringError("file_invalid",422,"The stored PDF does not match its upload record.");}
    const bytes=await boundedBytes({headers:new Headers(),body:object.body} as Request,MAX_PDF_BYTES);
    if(bytes.length!==file.size)throw new HiringError("file_invalid",422,"The stored PDF is incomplete.");
    const data=await (deps.extract||extractPdf)(bytes);
    if(!["timeout","unavailable"].includes(data.status))await deps.store.setSetting(key,data);
    return wrap(data);
  })();
  inFlight.set(key,pending);
  try{return await pending;}finally{inFlight.delete(key);}
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
