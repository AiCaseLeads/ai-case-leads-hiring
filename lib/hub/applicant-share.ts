import {shareViewerIdentity} from '../railway/share-viewer';
import {matchDetail} from '../ai/matching';
import {HubStore} from './store';
import {applicationTrash} from './application-lifecycle';
import {privateToken,sha256} from '../hiring/crypto';
import {HiringError} from '../hiring/errors';
import {applicationFileResponse} from './files';
import type {ApplicationDetail} from './types';
const prefix='applicant_share:';
export type Share={applicationId:string;expiresAt:number;hash:string;access?:ShareAccess;emails?:string[]};
export type ShareAccess='public'|'company'|'people';
export function shareAccess(input:{access?:unknown;emails?:unknown}){
 const access=input.access??'public';
 if(!['public','company','people'].includes(String(access))||input.emails!==undefined&&(!Array.isArray(input.emails)||input.emails.length>50))throw new HiringError('invalid_share',422,'Choose valid sharing access.');
 const emails=[...new Set((input.emails as unknown[]||[]).map(email=>typeof email==='string'?email.trim().toLowerCase():''))];
 if(emails.some(email=>email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||access==='people'&&!emails.length)throw new HiringError('invalid_share',422,'Add at least one valid email.');
 return {access:access as ShareAccess,emails:access==='people'?emails:[]};
}
const missing=()=>new HiringError('share_unavailable',404,'This shared application is unavailable or its link has expired.');
export function shareHeaders(response:Response){response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');return response;}
export async function manageApplicantShare(store:HubStore,id:string,method:string,days=7,options:{access?:unknown;emails?:unknown}={}){
 await store.applicationRow(id);
 const key=prefix+id;
 if(method==='DELETE'){const saved=await store.setting<Share|null>(key,null);await store.db.batch([store.stmt('DELETE FROM hub_settings WHERE key=?',key),...(saved?[store.stmt('DELETE FROM hub_settings WHERE key=?',prefix+'token:'+saved.hash)]:[])]);return {active:false};}
 if(await applicationTrash(store,id))throw missing();
 const saved=await store.setting<Share|null>(key,null);
 if(method==='GET')return saved&&saved.expiresAt>Date.now()?{active:true,expiresAt:saved.expiresAt,access:saved.access??'public',emails:saved.emails??[]}:{active:false};
 const token=privateToken(),hash=await sha256(token),expiresAt=Date.now()+days*86400000,value={applicationId:id,expiresAt,hash,...shareAccess(options)};
 await store.db.batch([
  store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM hub_settings WHERE key=?) THEN ? ELSE NULL END,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",key,'application_trash:'+id,JSON.stringify(value),Date.now()),
  store.stmt('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)',prefix+'token:'+hash,JSON.stringify(value),Date.now()),
  ...(saved?[store.stmt('DELETE FROM hub_settings WHERE key=?',prefix+'token:'+saved.hash)]:[]),
 ]);
 return {url:`/shared-applicants/${token}`,expiresAt,access:value.access,emails:value.emails};
}
export async function readCurrentShare(store:HubStore,token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw missing();
 const hash=await sha256(token),share=await store.setting<Share|null>(prefix+'token:'+hash,null);
 if(!share||share.expiresAt<=Date.now()||share.hash!==hash)throw missing();
 const current=await store.setting<Share|null>(prefix+share.applicationId,null);
 if(!current||current.hash!==hash||current.expiresAt<=Date.now()||await applicationTrash(store,share.applicationId))throw missing();
 if(!await store.stmt("SELECT id FROM hub_applications WHERE id=?",share.applicationId).first())throw missing();
 return {...current,access:current.access??'public',emails:current.emails??[]};
}
export function shareAllowsEmail(share:Share,email:string){return share.access==='public'||(share.access==='company'?email.split('@').length===2&&email.split('@')[1]==='aicaseleads.com':share.access==='people'&&(share.emails??[]).includes(email));}
async function resolveShare(store:HubStore,token:string,headers=new Headers()){
 const current=await readCurrentShare(store,token);
 const access=current.access??'public';
 if(access!=='public'){
  const identity=await shareViewerIdentity(headers,store.db);
  if(!identity)throw new HiringError('share_sign_in_required',401,'Verify your email to view this shared application.');
  const email=identity.email.toLowerCase();
  if(!shareAllowsEmail(current,email))throw new HiringError('share_access_denied',403,'This email address does not have access to this shared application.');
 }
 return current.applicationId;
}
function resumeFiles(detail:ApplicationDetail){
 const paths=new Set(detail.fields.filter(field=>field.type==='File'&&(field.path==='_systemfield_resume'||/^(?:r[eé]sum[eé](?:\s*\/\s*cv)?|cv|curriculum vitae)$/i.test(field.title.trim()))).map(field=>field.path));
 return detail.files.filter(file=>file.fieldPath&&paths.has(file.fieldPath));
}
export async function sharedApplicant(store:HubStore,token:string,headers=new Headers()){
 const id=await resolveShare(store,token,headers),detail=await store.getApplication(id);
 const fields=detail.fields.filter(field=>field.type!=='File').map(field=>({path:field.path,title:field.title,type:field.type,required:field.required,...(field.options?{options:field.options.map(option=>({value:option.value,label:option.label}))}:{}),...(field.numberFormat?{numberFormat:field.numberFormat,currency:field.currency}:{})}));
 const allowed=new Set(fields.map(field=>field.path));
 const match=await matchDetail(store,id);
 const aiMatch=match.status==='ready'?{status:'ready',score:match.score,criteria:match.criteria.map(item=>({criterion:item.criterion,status:item.status,explanation:item.explanation,citations:item.citations.map(citation=>({source:citation.source,quote:citation.quote}))})),checks:match.checks.map(item=>({question:item.question,citations:item.citations.map(citation=>({source:citation.source,quote:citation.quote}))}))}:{status:'unavailable',score:null,criteria:[],checks:[]};
 await resolveShare(store,token,headers);
 return shareHeaders(Response.json({name:detail.name,jobTitle:detail.jobTitle,fields,answers:detail.answers.filter(answer=>allowed.has(answer.path)).map(answer=>({path:answer.path,value:answer.value})),files:resumeFiles(detail).map(file=>({id:file.id,fieldPath:file.fieldPath,filename:file.filename,contentType:file.contentType,size:file.size,url:`/api/shared-applicants/${token}/files/${encodeURIComponent(file.id)}`})),aiMatch}));
}
export async function sharedApplicantFile(request:Request,store:HubStore,token:string,fileId:string,bucket?:Pick<R2Bucket,'get'>){
 const headers=request.headers;
 const id=await resolveShare(store,token,headers),detail=await store.getApplication(id);
 if(!resumeFiles(detail).some(file=>file.id===fileId))throw missing();
 const response=await applicationFileResponse(request,fileId,store.db,bucket);
 // Recheck after potentially expensive document conversion before releasing the response.
 try{await resolveShare(store,token,headers);}catch(error){await response.body?.cancel();throw error;}
 return shareHeaders(response);
}
