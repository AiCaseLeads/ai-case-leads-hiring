import { HiringError } from "../hiring/errors";
import type { ApplicationField, FieldSubmission } from "../hiring/types";
import type { ApplicationFilters, HubStore } from "./store";
import { applicationPdf, exportReportPdf, type MissingExportFile } from "../pdf/application";
const encoder=new TextEncoder();
export function csvCell(value:unknown):string {
  let text=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
  // Neutralize spreadsheet formula injection, including leading whitespace/control characters.
  if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
const headers=['Application ID','Name','Email','Job','Stage','Qualification','AI match score','AI match status','Reviewer grade percent','Applied at','Drive archive','Application answers'];
type RecordRow=Awaited<ReturnType<HubStore['exportRecord']>>;
export function readableAnswers(answers:FieldSubmission[],questions:ApplicationField[],files:{id:string;filename:string}[]=[]):string {
  const fields=new Map(questions.map(field=>[field.path,field]));
  return answers.map(answer=>{
    const field=fields.get(answer.path);
    const plain=(value:unknown):string=>{
      if(value===null||value===undefined||value==='')return 'Not provided';
      if(Array.isArray(value))return value.map(plain).join('; ');
      if(typeof value==='boolean')return value?'Yes':'No';
      if(field?.type==='File')return files.find(file=>file.id===value)?.filename||'Uploaded attachment';
      return field?.options?.find(option=>option.value===value)?.label||(typeof value==='object'?JSON.stringify(value):String(value));
    };
    return `${field?.title||answer.path}: ${plain(answer.value)}`;
  }).join('\n');
}
function csvRow(row:RecordRow){return [row.id,row.name,row.email,row.jobTitle,row.stage,row.qualification,row.aiMatch?.score,row.aiMatch?.status,row.grade?.scorePercent,new Date(row.createdAt).toISOString(),row.driveFolderUrl,readableAnswers(row.answers as FieldSubmission[],row.questions as ApplicationField[],row.files)].map(csvCell).join(',')+'\r\n';}
function streamOf(generator:AsyncGenerator<Uint8Array>):ReadableStream<Uint8Array> {
  return new ReadableStream({async pull(controller){try{const next=await generator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await generator.return(undefined);}});
}
// ZIP STORE with streaming data descriptors. Only central-directory metadata is retained.
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function words(size:number,fields:[number,number,number][]) {const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);for(const [offset,length,value] of fields){if(length===2)view.setUint16(offset,value,true);else view.setUint32(offset,value,true);}return bytes;}
export type ZipEntry={name:string;data:AsyncIterable<Uint8Array>};
export async function* zipStream(entries:AsyncIterable<ZipEntry>):AsyncGenerator<Uint8Array> {
  let position=0;const central:Uint8Array[]=[];
  for await(const entry of entries){
    const name=encoder.encode(entry.name),offset=position;
    const local=words(30,[[0,4,0x04034b50],[4,2,20],[6,2,0x0808],[26,2,name.length]]);
    yield local;yield name;position+=local.length+name.length;
    let crc=0xffffffff,size=0;
    for await(const chunk of entry.data){for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8);size+=chunk.byteLength;position+=chunk.byteLength;if(position>0xffff0000)throw new Error('ZIP exceeds 4 GB; narrow the export filters.');yield chunk;}
    crc=(crc^0xffffffff)>>>0;
    const descriptor=words(16,[[0,4,0x08074b50],[4,4,crc],[8,4,size],[12,4,size]]);yield descriptor;position+=16;
    central.push(words(46,[[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x0808],[16,4,crc],[20,4,size],[24,4,size],[28,2,name.length],[42,4,offset]]),name);
    if(central.length/2>65535)throw new Error('Too many files; narrow the export filters.');
  }
  const start=position;for(const chunk of central){yield chunk;position+=chunk.length;}
  yield words(22,[[0,4,0x06054b50],[8,2,central.length/2],[10,2,central.length/2],[12,4,position-start],[16,4,start]]);
}
async function* bytesData(bytes:Uint8Array){yield bytes;}
async function* bodyData(body:ReadableStream<Uint8Array>){const reader=body.getReader();try{while(true){const next=await reader.read();if(next.done)break;yield next.value;}}finally{await reader.cancel();reader.releaseLock();}}
export function safeFilename(value:string){return value.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g,'_').replace(/^\.+/,'_').slice(0,120)||'file';}
function attachmentFilename(value:string){
  const ascii=value.replace(/[^\x20-\x7e]/g,'_');
  const encoded=encodeURIComponent(value).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
export async function downloadApplications(request:Request,store:HubStore,filters:ApplicationFilters,bucket?:Pick<R2Bucket,'get'>,snapshotIds?:string[]):Promise<Response>{
  const params=new URL(request.url).searchParams,format=params.get('format');
  if(format!=='csv'&&format!=='zip'&&format!=='pdf')throw new HiringError('invalid_export_format',422,'Choose PDF, CSV or ZIP.');
  const rawIds=params.get('ids'),ids=snapshotIds ?? (rawIds===null?undefined:rawIds.split(','));
  if(ids && (!ids.length||ids.length>10000||ids.some(id=>!id||id.length>160)||new Set(ids).size!==ids.length))throw new HiringError('invalid_export_selection',422,'Select between 1 and 10,000 unique applications.');
  const selected=await store.exportIds(filters,ids);
  if(format==='pdf' && selected.length!==1)throw new HiringError('single_application_required',422,'Select one application for a PDF, or download multiple applications as a ZIP.');
  if(format==='zip'&&!bucket)throw new HiringError('storage_unavailable',503,'File storage is unavailable. Try CSV or retry later.');
  if(format==='zip') {
    let bytes=0,files=0;
    for(let offset=0;offset<selected.length;offset+=100){
      const batch=selected.slice(offset,offset+100);
      const total=await store.stmt(`SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM hub_files WHERE uploaded_at>0 AND application_id IN (${batch.map(()=>'?').join(',')})`,...batch).first<{count:number;bytes:number}>();
      bytes+=total?.bytes||0;files+=total?.count||0;
    }
    if(bytes>3*1024*1024*1024||files+selected.length+2>60000)throw new HiringError('export_too_large',422,'This archive is too large for one ZIP. Select fewer applications or narrower filters (up to 3 GB of attachments).');
  }
  if(params.get('check')==='1')return Response.json({count:selected.length,format},{headers:{'Cache-Control':'private, no-store'}});
  const jobs = new Map<string, Awaited<ReturnType<HubStore["getJob"]>>>();
  async function exportJob(id: string) {
    let job=jobs.get(id);
    if (!job) {job=await store.getJob(id);jobs.set(id,job);}
    return job;
  }
  async function pdfFor(id:string){
    const detail=await store.getApplication(id);
    const job=await exportJob(detail.jobId);
    return applicationPdf({...detail,jobDescription:{descriptionHtml:job.descriptionHtml,formVersion:job.formVersion,location:job.location}});
  }
  if(format==='pdf') {
    const detail=await store.getApplication(selected[0]);
    const job=await exportJob(detail.jobId);
    const pdf=await applicationPdf({...detail,jobDescription:{descriptionHtml:job.descriptionHtml,formVersion:job.formVersion,location:job.location}});
    return new Response(pdf as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':attachmentFilename(`application-${safeFilename(detail.name)}-${safeFilename(detail.id)}.pdf`),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Application-Count':'1'}});
  }
  async function* csv(){yield encoder.encode('\ufeff'+headers.map(csvCell).join(',')+'\r\n');for(const id of selected)yield encoder.encode(csvRow(await store.exportRecord(id)));}
  async function* entries():AsyncGenerator<ZipEntry>{
    const missing:MissingExportFile[]=[];let included=0;
    for(const id of selected){
      const row=await store.exportRecord(id),folder=safeFilename(row.name)+'-'+safeFilename(id);
      yield {name:folder+'/Application summary.pdf',data:bytesData(await pdfFor(id))};
      for(const file of row.files){
        let object;try{object=await bucket!.get(file.object_key);}catch{missing.push({applicationId:id,fileId:file.id,filename:file.filename,reason:'Storage read failed'});continue;}
        if(!object){missing.push({applicationId:id,fileId:file.id,filename:file.filename,reason:'File missing from storage'});continue;}
        if(object.size!==file.size || object.customMetadata?.fileId!==file.id){
          await object.body.cancel().catch(()=>undefined);
          missing.push({applicationId:id,fileId:file.id,filename:file.filename,reason:'Stored file identity or size does not match the application'});continue;
        }
        yield {name:folder+'/'+safeFilename(file.id)+'-'+safeFilename(file.filename),data:bodyData(object.body)};included++;
      }
    }
    yield {name:'Download report.pdf',data:bytesData(await exportReportPdf({exportedAt:Date.now(),jobId:filters.jobId || "Filtered applications",applicationCount:selected.length,includedFiles:included,missingFiles:missing}))};
  }
  return new Response(streamOf(format==='csv'?csv():zipStream(entries())),{headers:{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/zip','Content-Disposition':`attachment; filename="applications-${safeFilename(filters.jobId || "selected")}.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Application-Count':String(selected.length)}});
}
