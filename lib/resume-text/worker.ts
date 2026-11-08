import type {HubStore} from '../hub/store';
import {HiringError} from '../hiring/errors';
import {withinDeadline,DeadlineError} from '../hiring/deadline';
import {extractPdf} from '../pdf/extract';
import type {PdfResult} from '../pdf/types';
import {extractWordText} from '../word/extract';
import {claimFileText,discoverFileText,eligibleFileSql,MAX_RESUME_TEXT_CHARS,RESUME_TEXT_VERSION,RESUME_TEXT_MAX_ATTEMPTS,RESUME_BACKGROUND_CONCURRENCY,RESUME_BATCH_SIZE,type FileTextRow,type FileTextStatus} from './cache';

type Dependencies={store:HubStore;bucket:Pick<R2Bucket,'get'>;now?:()=>number;extractPdf?:typeof extractPdf;extractWord?:typeof extractWordText;storageTimeoutMs?:number;shouldStop?:()=>boolean};
type Result={status:FileTextStatus;text:string;truncated:boolean;ocrIncomplete:boolean;pages:number;ocrPages:number;errorCode:string|null};
class RetryableTextError extends Error {constructor(readonly code:string){super(code);}}
const terminalPdf=new Set(['ready','no_text','password_protected','invalid','too_many_pages','too_large']);

async function extract(row:FileTextRow,deps:Dependencies,now:number):Promise<Result|null>{
  const file=await deps.store.stmt(`SELECT f.object_key FROM hub_files f WHERE f.id=? AND f.uploaded_at=? AND f.size=? AND f.content_type=? AND ${eligibleFileSql()}`,row.file_id,row.uploaded_at,row.size,row.content_type,now).first<{object_key:string}>();
  if(!file)return null;
  // Promote only complete, identity-bound legacy results. Partial 30k AI text
  // must never masquerade as the full 200k export cache.
  if(row.content_type==='application/pdf'){
    const legacy=await deps.store.setting<PdfResult|null>(`pdf_text_v2_${row.file_id}_${row.uploaded_at}_${row.size}`,null);
    if(legacy&&terminalPdf.has(legacy.status)&&!legacy.truncated&&!legacy.ocrIncomplete&&typeof legacy.text==='string'&&legacy.text.length<=30000)return {status:legacy.status as FileTextStatus,text:legacy.text,truncated:false,ocrIncomplete:false,pages:legacy.pages,ocrPages:legacy.ocrPages??0,errorCode:legacy.status==='ready'?null:legacy.status};
  }
  const deadline=Date.now()+Math.max(1,Math.min(deps.storageTimeoutMs??5000,5000));
  let storageExpired=false;
  const get=deps.bucket.get(file.object_key).then(object=>{if(storageExpired&&object)void object.body.cancel().catch(()=>undefined);return object;});
  let object:R2ObjectBody|null;
  try{object=await withinDeadline(()=>get,deadline,'text_storage_timeout');}catch(error){storageExpired=true;throw error;}
  if(!object)throw new RetryableTextError('text_file_unavailable');
  if(object.size!==row.size||object.size>10*1024*1024||object.customMetadata?.fileId!==row.file_id){void object.body.cancel().catch(()=>undefined);return {status:'invalid',text:'',truncated:false,ocrIncomplete:false,pages:0,ocrPages:0,errorCode:'file_identity_mismatch'};}
  const reader=object.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const value=await withinDeadline(()=>reader.read(),deadline,'text_storage_timeout');if(value.done)break;size+=value.value.byteLength;if(size>row.size)throw new RetryableTextError('text_file_incomplete');chunks.push(value.value);}}
  catch(error){void reader.cancel().catch(()=>undefined);throw error;}finally{reader.releaseLock();}
  if(size!==row.size)throw new RetryableTextError('text_file_incomplete');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(row.content_type==='text/plain'){
    let decoded:string;
    try{if(bytes.includes(0))throw new Error('nul');decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return {status:'invalid',text:'',truncated:false,ocrIncomplete:false,pages:0,ocrPages:0,errorCode:'invalid_text_encoding'};}
    let text=decoded.slice(0,MAX_RESUME_TEXT_CHARS);
    // Do not leave half of a Unicode surrogate pair at the extraction boundary.
    if(text.length&&/[\uD800-\uDBFF]/.test(text.at(-1)!))text=text.slice(0,-1);
    return {status:text.trim()?'ready':'no_text',text:text.trim()?text:'',truncated:decoded.length>text.length,ocrIncomplete:false,pages:0,ocrPages:0,errorCode:text.trim()?null:'no_text'};
  }
  if(row.content_type==='application/pdf'){
    const data=await (deps.extractPdf??extractPdf)(bytes,45000,{maxTextChars:MAX_RESUME_TEXT_CHARS, background:row.lease_token?.startsWith('background:')});
    if(!terminalPdf.has(data.status))throw new RetryableTextError(`pdf_${data.status}`);
    return {status:data.status as FileTextStatus,text:data.text,truncated:data.truncated,ocrIncomplete:!!data.ocrIncomplete,pages:data.pages,ocrPages:data.ocrPages??0,errorCode:data.status==='ready'?null:data.status};
  }
  const data=await (deps.extractWord??extractWordText)(bytes,row.content_type,8000,row.lease_token?.startsWith('background:'));
  return {status:'ready',text:data.text,truncated:data.truncated,ocrIncomplete:false,pages:0,ocrPages:0,errorCode:null};
}

export async function processClaimedFileText(deps:Dependencies,row:FileTextRow):Promise<void>{
  const now=deps.now?.()??Date.now();
  let data:Result|null=null,code:string|null=null,busy=false,retry=false;
  try{data=await extract(row,deps,now);if(data&&data.text.length>MAX_RESUME_TEXT_CHARS)throw new RetryableTextError('text_parser_invalid');}
  catch(error){
    data=null;
    code=error instanceof RetryableTextError||error instanceof DeadlineError?error.code:error instanceof HiringError?error.code:'text_extraction_failed';
    busy=code==='pdf_busy'||code==='word_preview_busy';
    retry=busy||!(error instanceof HiringError&&error.status<500&&error.status!==429);
    if(!retry)data={status:'invalid',text:'',truncated:false,ocrIncomplete:false,pages:0,ocrPages:0,errorCode:code};
  }
  const finished=deps.now?.()??Date.now();
  const guard=`file_id=? AND status='running' AND lease_token=? AND EXISTS(SELECT 1 FROM hub_files f WHERE f.id=hub_file_text.file_id AND f.uploaded_at=hub_file_text.uploaded_at AND f.size=hub_file_text.size AND f.content_type=hub_file_text.content_type AND ${eligibleFileSql()})`;
  if(data){await deps.store.stmt(`UPDATE hub_file_text SET status=?,text=?,truncated=?,ocr_incomplete=?,pages=?,ocr_pages=?,error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE ${guard}`,data.status,data.text,data.truncated?1:0,data.ocrIncomplete?1:0,data.pages,data.ocrPages,data.errorCode,finished,row.file_id,row.lease_token,finished).run();}
  else if(retry){
    const again=busy||row.attempts<RESUME_TEXT_MAX_ATTEMPTS,delay=busy?5000:Math.min(60000,5000*2**(row.attempts-1));
    await deps.store.stmt(`UPDATE hub_file_text SET status=?,error_code=?,attempts=attempts-?,run_after=?,lease_token=NULL,lease_until=0,updated_at=? WHERE ${guard}`,again?'pending':'failed',code,busy?1:0,again?finished+delay:0,finished,row.file_id,row.lease_token,finished).run();
  }
  // Release an orphaned claim immediately after a concurrent delete/Trash or
  // identity change; never retain derived text from the previous file identity.
  await deps.store.stmt("UPDATE hub_file_text SET status='failed',text='',error_code='text_file_unavailable',lease_token=NULL,lease_until=0,updated_at=? WHERE file_id=? AND status='running' AND lease_token=?",finished,row.file_id,row.lease_token).run();
}

/** Claim just before parsing so a slow OCR file cannot exhaust the leases of
 * the rest of the batch. Await every lane before shutdown closes the database. */
export async function processResumeTextBatch(deps:Dependencies, maxFiles=RESUME_BATCH_SIZE):Promise<{processed:number;hasMore:boolean}>{
  if(!Number.isInteger(maxFiles) || maxFiles<1 || maxFiles>RESUME_BATCH_SIZE) throw new Error('resume_batch_limit_1_to_10');
  const now=()=>deps.now?.()??Date.now();
  const discovered=await discoverFileText(deps.store,now());
  let remaining=maxFiles,processed=0;
  async function runLane(){
    while(remaining>0 && !deps.shouldStop?.()){
      remaining--;
      const row=await claimFileText(deps.store,now());
      if(!row)return;
      await processClaimedFileText(deps,row);
      processed++;
    }
  }
  const lanes=await Promise.allSettled(Array.from({length:Math.min(maxFiles,RESUME_BACKGROUND_CONCURRENCY)},runLane));
  for(const lane of lanes)if(lane.status==='rejected')throw lane.reason;
  const waiting=await deps.store.stmt(`SELECT 1 FROM hub_file_text c JOIN hub_files f
    ON f.id=c.file_id AND f.uploaded_at=c.uploaded_at AND f.size=c.size AND f.content_type=c.content_type
    WHERE c.status IN ('pending','running') AND c.parser_version=? AND ${eligibleFileSql()} LIMIT 1`,
    RESUME_TEXT_VERSION,now()).first();
  return {processed,hasMore:!!waiting||discovered===100};
}
