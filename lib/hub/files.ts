import { documentStructure } from "../hiring/document-structure";
import { extractWordText, WORD_MIMES } from "../word/extract";
import type { HubMember } from './auth-core';
import { HiringError } from '../hiring/errors';
import { boundedBytes, fileSignature } from '../hiring/files';
import { MAX_FILE_BYTES } from '../hiring/validation';

/** Original uploads are private. Only verified PDF/raster bytes may render inline. */
export async function privateApplicationFile(request:Request,id:string,member:HubMember|null,db?:D1Database,bucket?:Pick<R2Bucket,'get'>):Promise<Response>{
  if(!member?.email)throw new HiringError('staff_access_required',403,'Sign in with an authorized hiring account.');
  if(!db||!bucket)throw new HiringError('storage_unavailable',503,'File storage is unavailable.');
  const preview=new URL(request.url).searchParams.get('preview')==='1';
  const file=await db.prepare('SELECT filename,content_type,object_key,size FROM hub_files WHERE id=? AND application_id IS NOT NULL AND uploaded_at>0').bind(id).first<{filename:string;content_type:string;object_key:string;size:number}>();
  if(!file)throw new HiringError('file_not_found',404,'This file is unavailable.');
  if(preview&&!['application/pdf','image/png','image/jpeg','image/webp',...WORD_MIMES].includes(file.content_type))throw new HiringError('preview_unavailable',415,'Download this file to open it. Inline preview supports PDF, Word text, PNG, JPG and WebP.');
  const object=await bucket.get(file.object_key);
  if(!object)throw new HiringError('file_not_found',404,'This file is unavailable.');
  if(preview&&(object.size!==file.size||object.customMetadata?.fileId!==id)){await object.body.cancel();throw new HiringError('file_identity_mismatch',409,'This file could not be verified. Please contact your hiring administrator.');}
  const filename=encodeURIComponent(file.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const headers=new Headers({'Content-Type':file.content_type,'Content-Disposition':`${preview?'inline':'attachment'}; filename*=UTF-8''${filename}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox; frame-ancestors 'self'",'X-Frame-Options':'SAMEORIGIN','Cross-Origin-Resource-Policy':'same-origin'});
  if(!preview)return new Response(object.body,{headers});
  // Uploads are bounded to 10 MB. Validate actual bytes before the browser can render them.
  const bytes=await boundedBytes(new Request(request.url,{method:'POST',body:object.body,duplex:'half'} as RequestInit),MAX_FILE_BYTES);
  if(bytes.length!==file.size||!fileSignature(bytes,file.content_type))throw new HiringError('preview_unavailable',415,'This file cannot be safely previewed. Download the original instead.');
  if(new URL(request.url).searchParams.get('format')==='docx'){
    if(file.content_type!=='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||!documentStructure(bytes,file.content_type,true))throw new HiringError('preview_unavailable',415,'This document cannot be safely previewed. Download the original instead.');
    headers.set('Content-Length',String(bytes.length));
    return new Response(request.method==='HEAD'?null:bytes as BodyInit,{headers});
  }
  if(WORD_MIMES.includes(file.content_type)){
    headers.set('Content-Type','text/plain; charset=utf-8');
    headers.set('X-Preview-Format','word-text');
    // HEAD is a cheap capability check. GET alone runs bounded parsing.
    if(request.method==='HEAD')return new Response(null,{headers});
    const result=await extractWordText(bytes,file.content_type);
    headers.set('X-Preview-Truncated',String(result.truncated));
    return new Response(result.text,{headers});
  }
  headers.set('Accept-Ranges','bytes');
  const range=request.headers.get('range');
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    let start=0,end=bytes.length-1;
    if(match&&(match[1]||match[2])){
      if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
      else start=Math.max(0,bytes.length-Number(match[2]));
    }else start=bytes.length;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=bytes.length||end<start){headers.set('Content-Range',`bytes */${bytes.length}`);return new Response(null,{status:416,headers});}
    headers.set('Content-Range',`bytes ${start}-${end}/${bytes.length}`);headers.set('Content-Length',String(end-start+1));
    return new Response(bytes.slice(start,end+1) as BodyInit,{status:206,headers});
  }
  headers.set('Content-Length',String(bytes.length));
  return new Response(bytes as BodyInit,{headers});
}
