import { isCountryResidence } from "../countries";
import { MATCH_PROVIDER_PAUSE_KEY } from "./provider-errors";
import { matchHourlyLimit,MIN_MATCH_HOURLY_LIMIT,MAX_MATCH_HOURLY_LIMIT } from "./capacity";
import { hourlyRateWindow } from "../hiring/rate-window";
import { z } from "zod";
import { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import { parse } from "../hub/validation";
import { sealToken, openToken } from "../google/oauth";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { sha256 } from "../hiring/crypto";
import { MODEL,criteriaLines,generateReview,reviewInput,reviewNote,validateReview,type Review,type Sources } from "./review";

import { readResumeText } from "../pdf/http";

const CONFIG = "ai_openrouter_config_v1";
type Configuration = {enabled:boolean;sealedKey?:string;updatedBy?:string;updatedAt?:number;hourlyLimit?:number};
const configInput=z.object({apiKey:z.string().trim().regex(/^sk-or-[A-Za-z0-9_-]{16,250}$/).optional(),enabled:z.boolean(),hourlyLimit:z.number().int().min(MIN_MATCH_HOURLY_LIMIT).max(MAX_MATCH_HOURLY_LIMIT).optional()}).strict();
export type AiDependencies={store:HubStore;encryptionKey?:string;fetcher?:typeof fetch;bucket?:R2Bucket};
async function json(request:Request){
  const bytes=await boundedBytes(request,256*1024);
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HiringError("invalid_request",400,"The request could not be read.");}
}
function requireMember(member:HubMember|null):asserts member is HubMember{
  if(!member || !["admin","recruiter"].includes(member.role))throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring team account.");
}
function configStatus(config:Configuration,key?:string,member?:HubMember){
  const configured=!!config.sealedKey&&!!key;
  return {configured,enabled:configured&&config.enabled,model:MODEL,provider:"OpenRouter / OpenAI",reviewOnly:true,hourlyLimit:matchHourlyLimit(config),processingConcurrency:3,canManageConnection:!!member?.isOwner,canChangeCapacity:member?.role==="admin"};
}
export async function handleAiConfig(request:Request,member:HubMember|null,deps:AiDependencies):Promise<Response>{
  try{
    requireMember(member);
    const snapshot=await deps.store.stmt("SELECT value FROM hub_settings WHERE key=?",CONFIG).first<{value:string}>();
    const config:Configuration=snapshot?JSON.parse(snapshot.value):{enabled:false};
    if(request.method==="GET")return jsonResponse({data:configStatus(config,deps.encryptionKey,member)});
    if(request.method!=="PATCH")throw new HiringError("method_not_allowed",405,"Use the configuration form to update AI settings.");
    assertSameOrigin(request);
    const input=parse(configInput,await json(request));
    if(!member.isOwner&&(member.role!=="admin"||input.apiKey!==undefined||input.enabled!==config.enabled||input.hourlyLimit===undefined))throw new HiringError("owner_access_required",403,"Only the account owner can configure the AI connection. Administrators can adjust processing capacity.");
    if(!deps.encryptionKey)throw new HiringError("encryption_unavailable",503,"Server credential encryption must be configured before saving an API key.");
    const sealedKey=input.apiKey?await sealToken(input.apiKey,deps.encryptionKey):config.sealedKey;
    if(input.enabled&&!sealedKey)throw new HiringError("ai_key_required",422,"Add an OpenRouter API key before enabling AI review.");
    const updated={enabled:input.enabled,sealedKey,hourlyLimit:input.hourlyLimit??matchHourlyLimit(config),updatedBy:member.email,updatedAt:Date.now()};
    // The first statement is a transaction guard. A capacity-only administrator
    // must never restore an owner’s connection/key from a stale configuration.
    const save=snapshot
      ?deps.store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM hub_settings WHERE key=? AND value=?) THEN ? ELSE NULL END,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",CONFIG,CONFIG,snapshot.value,JSON.stringify(updated),Date.now())
      :deps.store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM hub_settings WHERE key=?) THEN ? ELSE NULL END,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",CONFIG,CONFIG,JSON.stringify(updated),Date.now());
    try{await deps.store.db.batch([
      save,
      ...(input.apiKey?[deps.store.stmt("DELETE FROM hub_settings WHERE key=?",MATCH_PROVIDER_PAUSE_KEY)]:[]),
      ...(updated.hourlyLimit>matchHourlyLimit(config)?[deps.store.stmt("UPDATE hub_ai_matches SET run_after=0,error=NULL WHERE status='pending' AND error='ai_hourly_capacity'")]:[]),
    ]);}catch(error){
      if(/NOT NULL|constraint/i.test(String(error)))throw new HiringError("ai_config_conflict",409,"The AI settings changed while you were saving. Refresh and try again; no settings were overwritten.");
      throw error;
    }
    return jsonResponse({data:configStatus(updated,deps.encryptionKey,member)});
  }catch(error){return errorResponse(error);}
}
type Cache={status:"pending"|"complete"|"failed";review?:Review};
async function limit(store:HubStore,key:string,max:number){
  const result=await store.stmt("INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts",await sha256(key),hourlyRateWindow(),max).first();
  if(!result)throw new HiringError("ai_rate_limited",429,"AI review's hourly limit was reached. Continue manual review or try later.");
}
export function answerSource(application:Awaited<ReturnType<HubStore["getApplication"]>>):string{
  // Normalize field identifiers before matching whole words: "age" must not
  // remove job evidence such as "languages" or "project_management".
  const skip=/\b(?:name|email|phone|address|birth|birthday|birthdate|dob|age|gender|sex|religion|race|ethnicity|ethnic|disability|disabilities|disabled|health|marital|nationality|citizen|citizenship)\b/i;
  const label=(path:string,title:string)=>`${path} ${title}`.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_\W]+/g," ");
  // Residence eligibility is a deterministic screening rule, not AI job-match evidence.
  const fields=application.fields.filter(f=>!isCountryResidence(f)&&!f.path.startsWith("_systemfield_")&&!skip.test(label(f.path,f.title))&&!["File","Email","Phone","Url","SocialLink"].includes(f.type));
  return fields.map(f=>({question:f.title,answer:application.answers.find(a=>a.path===f.path)?.value??null})).map(x=>JSON.stringify(x)).join("\n").slice(0,20000);
}
export async function handleAiReview(request:Request,member:HubMember|null,deps:AiDependencies):Promise<Response>{
  try{
    requireMember(member);
    if(request.method!=="POST")throw new HiringError("method_not_allowed",405,"Use the AI review form to request evidence.");
    assertSameOrigin(request);
    const input=parse(reviewInput,await json(request));
    const criteria=criteriaLines(input.jobCriteria);
    const config=await deps.store.setting<Configuration>(CONFIG,{enabled:false});
    if(!config.enabled||!config.sealedKey||!deps.encryptionKey)throw new HiringError("ai_not_configured",409,"AI review is off. A manager can connect OpenRouter in Settings.");
    const application=await deps.store.getApplication(input.applicationId);
    const pdf=input.resumeFileId?await readResumeText(input.applicationId,input.resumeFileId,{store:deps.store,bucket:deps.bucket}):null;
    if(pdf&&pdf.status!=="ready")throw new HiringError("pdf_not_readable",422,pdf.message);
    const sources:Sources={resume:pdf?pdf.text:input.resumeText,linkedin:input.linkedinText,answers:answerSource(application)};
    if(!sources.resume&&!sources.linkedin&&!sources.answers)throw new HiringError("ai_sources_required",422,"Add resume or candidate-supplied profile excerpts before reviewing.");
    const provenance=pdf?`Original PDF: ${pdf.filename} (file ${pdf.fileId}), ${pdf.pages} pages.${pdf.ocrPages?` Local OCR used on ${pdf.ocrPages} pages; recognition can misread text.`:""} ${(pdf.truncated||pdf.ocrIncomplete)?"PARTIAL: some text was not read; inspect the original for remaining evidence.":"Automatically extracted text; inspect the original for missed layout, images or text."}`:"Reviewer-supplied excerpts.";
    const hash=await sha256(JSON.stringify({applicationId:input.applicationId,model:MODEL,criteria,sources,provenance}));
    const cacheKey=`ai_review_v1_${hash}`;
    let cache=await deps.store.setting<Cache|null>(cacheKey,null);
    let review=cache?.status==="complete"&&cache.review?validateReview(cache.review,sources,criteria):undefined;
    const cached=!!review;
    if(review&&application.notes.some(note=>note.text===reviewNote(review!,hash,provenance)))return jsonResponse({data:{review,application,model:MODEL,cached:true}});
    if(application.revision!==input.expectedRevision)throw new HiringError("application_conflict",409,"The application changed. Refresh it before running AI review.");
    if(!review){
      await limit(deps.store,`ai:staff:${member.userId}`,30);
      await limit(deps.store,`ai:application:${input.applicationId}`,10);
      const claimToken=crypto.randomUUID();
      const claimed=await deps.store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE hub_settings.updated_at<? AND json_extract(hub_settings.value,'$.status')!='complete' RETURNING key",cacheKey,JSON.stringify({status:"pending",claimToken}),Date.now(),Date.now()-180000).first();
      if(!claimed){
        cache=await deps.store.setting<Cache|null>(cacheKey,null);
        if(cache?.status==="complete"&&cache.review)review=validateReview(cache.review,sources,criteria);
        else throw new HiringError("ai_review_pending",409,"This review is already running or recently failed. Wait three minutes before retrying.");
      }else{
        try{
          review=await generateReview(await openToken(config.sealedKey,deps.encryptionKey),sources,criteria,deps.fetcher);
          const saved=await deps.store.stmt("UPDATE hub_settings SET value=?,updated_at=? WHERE key=? AND json_extract(value,'$.claimToken')=? RETURNING key",JSON.stringify({status:"complete",review}),Date.now(),cacheKey,claimToken).first();
          if(!saved)throw new HiringError("ai_review_pending",409,"Another request took over this review. Refresh before retrying.");
        }catch(error){await deps.store.stmt("UPDATE hub_settings SET value=?,updated_at=? WHERE key=? AND json_extract(value,'$.claimToken')=?",JSON.stringify({status:"failed"}),Date.now(),cacheKey,claimToken).run();throw error;}
      }
    }
    const updated=await deps.store.action(input.applicationId,{action:"note",text:reviewNote(review!,hash,provenance),expectedRevision:input.expectedRevision},member);
    return jsonResponse({data:{review,application:updated,model:MODEL,cached}});
  }catch(error){return errorResponse(error);}
}
