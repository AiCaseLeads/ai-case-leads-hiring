import {authorizeAgent} from './access';
import {HubStore,APPLICATION_SORTS,applicationDateBounds,type ApplicationFilters} from '../hub/store';
import {applicationTrash} from '../hub/application-lifecycle';
import {matchDetail} from '../ai/matching';
import {withinDeadline} from '../hiring/deadline';
import {STAGES} from '../hub/types';
import {HiringError} from '../hiring/errors';
import {jsonResponse,errorResponse} from '../hiring/http';
import {boundedBytes,fileSignature} from '../hiring/files';
import {MAX_FILE_BYTES} from '../hiring/validation';
import {extractPdf} from '../pdf/extract';
import {extractWordText,WORD_MIMES} from '../word/extract';
const invalid=()=>new HiringError('invalid_filter',422,'Check the requested filters and pagination.');
function positive(value:string|null,fallback:number,max:number){if(value===null)return fallback;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw invalid();return Number(value);}
function filters(p:URLSearchParams):ApplicationFilters{
 const stage=p.get('stage')||undefined,excludeStage=p.get('excludeStage')||undefined,sort=p.get('sort')||undefined,qualification=p.get('qualification')||undefined,q=p.get('q')||undefined;
 if(p.has('trash')||[stage,excludeStage].some(v=>v&&!STAGES.includes(v as typeof STAGES[number]))||sort&&!APPLICATION_SORTS.includes(sort as typeof APPLICATION_SORTS[number])||qualification&&!['pass','review','fail'].includes(qualification)||q&&q.length>200||p.has('active')&&!['true','false'].includes(p.get('active')||''))throw invalid();
 const result:ApplicationFilters={stage,excludeStage,sort:sort as ApplicationFilters['sort'],qualification:qualification as ApplicationFilters['qualification'],q,jobId:p.get('jobId')||undefined,assignee:p.get('assignee')||undefined,page:positive(p.get('page'),1,100000),active:p.get('active')==='true',appliedFrom:p.get('appliedFrom')||undefined,appliedTo:p.get('appliedTo')||undefined,timeZone:p.get('timeZone')||undefined};applicationDateBounds(result);return result;
}
// Candidate invitation/share capability tokens must never escape in note/email text or nested URLs.
export function safeAgentData(value:unknown,keyContext=''):unknown{
 if(typeof value==='string'){if(/^(id|applicationId|fileId|jobId|taskId|providerMeetingId|interviewId)$/.test(keyContext))return value;return value.replace(/https?:\/\/[^\s<>"']+/gi,url=>{for(let n=0;n<2;n++){try{const decoded=decodeURIComponent(url);if(decoded===url)break;url=decoded;}catch{break}}return url.replace(/[a-f0-9]{64}/gi,'[redacted-token]');}).replace(/\b[a-f0-9]{64}\b/gi,'[redacted-token]').replace(/hiring_[a-f0-9-]{36}_[a-f0-9]{64}/gi,'[redacted-token]');}
 if(Array.isArray(value))return value.map(item=>safeAgentData(item));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:token|secret|password|bookingUrl|assessmentUrl|objectKey|object_key|sessionHash|session_hash)/i.test(key)).map(([key,v])=>[key,safeAgentData(v,key)]));return value;
}
const decode=(value:string|null)=>{try{return JSON.parse(value||'null')}catch{return null}};
function cappedJson(data:unknown){const clean=safeAgentData(data),encoded=JSON.stringify({data:clean});if(new TextEncoder().encode(encoded).length>1024*1024)throw new HiringError('response_too_large',413,'Reduce sectionPageSize or request an individual evidence record.');return jsonResponse({data:clean});}
async function applicationDetail(store:HubStore,id:string,p:URLSearchParams){
 const app=await store.applicationRow(id),pageSize=positive(p.get('sectionPageSize'),10,50);
 async function section(table:string,columns:string,pageKey:string,order:string){const page=positive(p.get(pageKey),1,100000),count=await store.stmt(`SELECT count(*) n FROM ${table} WHERE application_id=?`,id).first<{n:number}>();const items=await store.rows<Record<string,unknown>>(`SELECT ${columns} FROM ${table} WHERE application_id=? ORDER BY ${order} LIMIT ? OFFSET ?`,id,pageSize,(page-1)*pageSize);return {items,total:count?.n||0,page,pageSize};}
 const history=await section('hub_history',"id,type,substr(text,1,20000) text,length(text)>20000 AS textTruncated,actor,created_at AS createdAt",'historyPage','created_at DESC,id DESC');
 const communications=await section('hub_communications',"id,subject,substr(body,1,20000) body,length(body)>20000 AS bodyTruncated,status,created_at AS createdAt",'communicationsPage','created_at DESC,id DESC');
 const interviews=await section('hub_interviews','id,status,start,end,time_zone AS timeZone,meet_url AS meetUrl,attended,revision,created_at AS createdAt','interviewsPage','created_at DESC,id DESC');
 const notes=await section('hub_history',"id,type,substr(text,1,20000) text,length(text)>20000 AS textTruncated,actor,created_at AS createdAt",'notesPage','created_at DESC,id DESC');
 const notesCount=await store.stmt("SELECT count(*) n FROM hub_history WHERE application_id=? AND type='note'",id).first<{n:number}>();const notesPage=positive(p.get('notesPage'),1,100000);notes.items=await store.rows<Record<string,unknown>>("SELECT id,substr(text,1,20000) text,length(text)>20000 AS textTruncated,actor,created_at AS createdAt FROM hub_history WHERE application_id=? AND type='note' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",id,pageSize,(notesPage-1)*pageSize);notes.total=notesCount?.n||0;
 const files=await store.rows<{id:string;filename:string;contentType:string;size:number;fieldPath:string}>('SELECT id,filename,content_type AS contentType,size,field_path AS fieldPath FROM hub_files WHERE application_id=? AND uploaded_at>0 ORDER BY filename,id',id);
 const review=await store.stmt('SELECT version,recommendation,notes,summary,recording_url AS recordingUrl,salary_expectation AS salaryExpectation,availability,concerns,updated_by AS updatedBy,updated_at AS updatedAt FROM hub_recruiter_reviews WHERE application_id=?',id).first();
 const evidencePage=positive(p.get('evidencePage'),1,100000),prefix='interview_evidence:'+id+':',evidenceCount=await store.stmt('SELECT count(*) n FROM hub_settings WHERE substr(key,1,?)=?',prefix.length,prefix).first<{n:number}>(),evidenceRows=await store.rows<{value:string}>('SELECT value FROM hub_settings WHERE substr(key,1,?)=? ORDER BY updated_at DESC,key DESC LIMIT ? OFFSET ?',prefix.length,prefix,pageSize,(evidencePage-1)*pageSize);
 const evidence=evidenceRows.flatMap(row=>{const v=decode(row.value);if(!v||typeof v!=='object')return [];const transcript=typeof v.transcript==='string'?v.transcript:'';return [{providerMeetingId:v.providerMeetingId,interviewId:v.interviewId,recordingUrl:v.recordingUrl,summary:v.summary,transcript:transcript.slice(0,20000),transcriptCharacters:transcript.length,transcriptTruncated:transcript.length>20000,attachedAt:v.attachedAt}]});
 const recordingsPage=positive(p.get('recordingsPage'),1,100000),recordingWhere="key LIKE 'interview_recording:%' AND json_valid(value) AND json_extract(value,'$.applicationId')=?",recordingCount=await store.stmt('SELECT count(*) n FROM hub_settings WHERE '+recordingWhere,id).first<{n:number}>(),recordings=await store.rows<{value:string}>('SELECT value FROM hub_settings WHERE '+recordingWhere+' ORDER BY updated_at DESC,key DESC LIMIT ? OFFSET ?',id,pageSize,(recordingsPage-1)*pageSize);
 return {id:app.id,jobId:app.job_id,jobTitle:app.job_title,name:app.name,email:app.email,stage:app.stage,qualification:app.qualification,assignee:app.assignee,revision:app.revision,createdAt:app.created_at,updatedAt:app.updated_at,answers:decode(app.answers_json),fields:decode(app.fields_json),qualificationEvidence:decode(app.qualification_json),aiMatch:await matchDetail(store,id),files:files.map(file=>({...file,contentAction:'file_content',textAction:'file_text',applicationId:id})),recruiterReview:review,history,notes,communications,interviews,evidence:{items:evidence,total:evidenceCount?.n||0,page:evidencePage,pageSize},recordings:{items:recordings.flatMap(row=>{const v=decode(row.value);return v?.applicationId===id?[{id:v.id,filename:v.filename,contentType:v.contentType,size:v.size,createdAt:v.createdAt,streamAvailableThroughStaffSession:true}]:[]}),total:recordingCount?.n||0,page:recordingsPage,pageSize},untrustedContent:true};
}
let activeFileReads=0;
async function originalBytes(request:Request,bucket:Pick<R2Bucket,'get'>,key:string,file:{id:string;size:number}){
 if(activeFileReads>=2)throw new HiringError('file_busy',429,'Two private files are being read. Retry shortly.');activeFileReads++;
 let body:ReadableStream<Uint8Array>|undefined;
 try{const deadline=Date.now()+10000,object=await withinDeadline(()=>bucket.get(key),deadline,'storage_timeout');if(!object)throw new HiringError('file_not_found',404,'This file is unavailable.');body=object.body;
 if(object.size!==file.size||object.customMetadata?.fileId!==file.id||file.size>MAX_FILE_BYTES)throw new HiringError('file_identity_mismatch',409,'The original file could not be verified.');
 const bytes=await withinDeadline(()=>boundedBytes(new Request(request.url,{method:'POST',body:object.body,duplex:'half'} as RequestInit),MAX_FILE_BYTES),deadline,'storage_timeout');if(bytes.length!==file.size)throw new HiringError('file_identity_mismatch',409,'The original file could not be verified.');return bytes;
 }finally{activeFileReads--;if(body&&!body.locked)void body.cancel().catch(()=>undefined);}
}
async function auditRead(store:HubStore,agentId:string,operation:string,applicationId?:string){await store.stmt('INSERT INTO hub_audit(id,type,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),'agent_read','agent:'+agentId,'null',JSON.stringify({operation,...(applicationId?{applicationId}: {})}),Date.now()).run();}
async function activeApplication(store:HubStore,id:string){if(!id||await applicationTrash(store,id))throw new HiringError('application_not_found',404,'This application is unavailable.');await store.applicationRow(id);}
export async function handleAgentRead(request:Request,store:HubStore,bucket?:Pick<R2Bucket,'get'>):Promise<Response>{try{
 if(request.method!=='GET')throw new HiringError('method_not_allowed',405,'Use GET for read-only access.');
 const p=new URL(request.url).searchParams,action=p.get('action'),applicationId=p.get('applicationId')||'';
 if(action==='list_jobs'){
 const access=await authorizeAgent(store,request,'jobs:read');await auditRead(store,access.id,'list_jobs');const page=positive(p.get('page'),1,100000),pageSize=positive(p.get('pageSize'),30,100),status=p.get('status'),q=p.get('q');if(status&&!['open','paused','draft','closed'].includes(status)||q&&q.length>200)throw invalid();
 const clauses:string[]=["NOT EXISTS(SELECT 1 FROM hub_settings lifecycle WHERE lifecycle.key='job_lifecycle_'||hub_jobs.id AND json_valid(lifecycle.value) AND json_extract(lifecycle.value,'$.state')='deleted')"],values:string[]=[];if(status){clauses.push('status=?');values.push(status)}if(q){clauses.push('(instr(lower(title),lower(?))>0 OR instr(lower(department),lower(?))>0)');values.push(q,q)}const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
 const count=await store.stmt('SELECT count(*) n FROM hub_jobs'+where,...values).first<{n:number}>(),ids=await store.rows<{id:string}>('SELECT id FROM hub_jobs'+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',...values,pageSize,(page-1)*pageSize);
 return cappedJson({items:await Promise.all(ids.map(row=>store.getJob(row.id))),total:count?.n||0,page,pageSize});
 }
 const access=await authorizeAgent(store,request,'applicants:read');
 if(action==='list_applicants'){await auditRead(store,access.id,'list_applicants');if(p.has('pageSize')&&p.get('pageSize')!=='30')throw new HiringError('invalid_page_size',422,'Applicant lists use 30 records per page.');return cappedJson(await store.applications(filters(p)));}
 if(!['get_applicant','list_files','file_content','file_text','get_interview_evidence'].includes(action||''))throw new HiringError('invalid_action',422,'Choose a supported read action.');
 await activeApplication(store,applicationId);
 if(action==='file_content'||action==='file_text')await authorizeAgent(store,request,'files:read');
 await auditRead(store,access.id,action!,applicationId);
 if(action==='get_applicant')return cappedJson(await applicationDetail(store,applicationId,p));
 if(action==='get_interview_evidence'){const meetingId=p.get('meetingId')||'';if(!/^[A-Za-z0-9_-]{1,200}$/.test(meetingId))throw invalid();const evidence=await store.setting<Record<string,unknown>|null>('interview_evidence:'+applicationId+':'+meetingId,null);if(!evidence)throw new HiringError('evidence_not_found',404,'Interview evidence was not found.');const offset=positive(p.get('textPage'),1,100000),transcript=typeof evidence.transcript==='string'?evidence.transcript:'',chunk=transcript.slice((offset-1)*20000,offset*20000);return cappedJson({providerMeetingId:evidence.providerMeetingId,interviewId:evidence.interviewId,summary:evidence.summary,recordingUrl:evidence.recordingUrl,transcript:chunk,textPage:offset,textPageSize:20000,totalCharacters:transcript.length,hasMore:offset*20000<transcript.length,untrustedContent:true});}
 const files=await store.rows<{id:string;filename:string;content_type:string;size:number;field_path:string}>('SELECT id,filename,content_type,size,field_path FROM hub_files WHERE application_id=? AND uploaded_at>0 ORDER BY filename,id',applicationId);
 if(action==='list_files')return cappedJson({items:files});
 await authorizeAgent(store,request,'files:read');const fileId=p.get('fileId')||'',file=files.find(f=>f.id===fileId);if(!file)throw new HiringError('file_not_found',404,'This file does not belong to the requested application.');if(!bucket)throw new HiringError('storage_unavailable',503,'File storage is unavailable.');
 const row=await store.stmt('SELECT object_key FROM hub_files WHERE id=? AND application_id=?',fileId,applicationId).first<{object_key:string}>();if(!row)throw new HiringError('file_not_found',404,'This file is unavailable.');const bytes=await originalBytes(request,bucket,row.object_key,file);
 if(action==='file_content')return new Response(bytes as BodyInit,{headers:{'Content-Type':file.content_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 if(!fileSignature(bytes,file.content_type))throw new HiringError('file_identity_mismatch',409,'The document format could not be verified.');
 if(file.content_type==='application/pdf'){const result=await extractPdf(bytes,15000);return cappedJson({fileId,...result,untrustedContent:true})}if(WORD_MIMES.includes(file.content_type))return cappedJson({fileId,...await extractWordText(bytes,file.content_type),untrustedContent:true});throw new HiringError('text_unavailable',415,'Text extraction supports PDF and Word documents.');
 }catch(error){return errorResponse(error)}}
