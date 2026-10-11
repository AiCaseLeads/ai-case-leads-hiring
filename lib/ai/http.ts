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

const CONFIG = "ai_openrouter_config_v1";
type Configuration = {enabled:boolean;sealedKey?:string;updatedBy?:string;updatedAt?:number};
const configInput=z.object({apiKey:z.string().trim().regex(/^sk-or-[A-Za-z0-9_-]{16,250}$/).optional(),enabled:z.boolean()}).strict();
export type AiDependencies={store:HubStore;encryptionKey?:string;fetcher?:typeof fetch};
async function json(request:Request){
  const bytes=await boundedBytes(request,256*1024);
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HiringError("invalid_request",400,"The request could not be read.");}
}
function requireMember(member:HubMember|null):asserts member is HubMember{
  if(!member || !["admin","recruiter"].includes(member.role))throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring team account.");
}
function configStatus(config:Configuration,key?:string){
  const configured=!!config.sealedKey&&!!key;
  return {configured,enabled:configured&&config.enabled,model:MODEL,provider:"OpenRouter / OpenAI",reviewOnly:true};
}
export async function handleAiConfig(request:Request,member:HubMember|null,deps:AiDependencies):Promise<Response>{
  try{
    requireMember(member);
    const config=await deps.store.setting<Configuration>(CONFIG,{enabled:false});
    if(request.method==="GET")return jsonResponse({data:configStatus(config,deps.encryptionKey)});
    if(request.method!=="PATCH")throw new HiringError("method_not_allowed",405,"Use the configuration form to update AI settings.");
    assertSameOrigin(request);
    if(member.role!=="admin")throw new HiringError("admin_access_required",403,"Only managers can configure AI review.");
    const input=parse(configInput,await json(request));
    if(!deps.encryptionKey)throw new HiringError("encryption_unavailable",503,"Server credential encryption must be configured before saving an API key.");
    const sealedKey=input.apiKey?await sealToken(input.apiKey,deps.encryptionKey):config.sealedKey;
    if(input.enabled&&!sealedKey)throw new HiringError("ai_key_required",422,"Add an OpenRouter API key before enabling AI review.");
    const updated={enabled:input.enabled,sealedKey,updatedBy:member.email,updatedAt:Date.now()};
    await deps.store.setSetting(CONFIG,updated);
    return jsonResponse({data:configStatus(updated,deps.encryptionKey)});
  }catch(error){return errorResponse(error);}
}
type Cache={status:"pending"|"complete"|"failed";review?:Review};
async function limit(store:HubStore,key:string,max:number){
  const result=await store.stmt("INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts",await sha256(key),Math.floor(Date.now()/3600000),max).first();
  if(!result)throw new HiringError("ai_rate_limited",429,"AI review's hourly limit was reached. Continue manual review or try later.");
}
function answerSource(application:Awaited<ReturnType<HubStore["getApplication"]>>):string{
  // Normalize field identifiers before matching whole words: "age" must not
  // remove job evidence such as "languages" or "project_management".
  const skip=/\b(?:name|email|phone|address|birth|birthday|birthdate|dob|age|gender|sex|religion|race|ethnicity|ethnic|disability|disabilities|disabled|health|marital|nationality|citizen|citizenship)\b/i;
  const label=(path:string,title:string)=>`${path} ${title}`.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_\W]+/g," ");
  const fields=application.fields.filter(f=>!f.path.startsWith("_systemfield_")&&!skip.test(label(f.path,f.title))&&!["File","Email","Phone","Url","SocialLink"].includes(f.type));
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
    const sources:Sources={resume:input.resumeText,linkedin:input.linkedinText,answers:answerSource(application)};
    if(!sources.resume&&!sources.linkedin&&!sources.answers)throw new HiringError("ai_sources_required",422,"Add resume or candidate-supplied profile excerpts before reviewing.");
    const hash=await sha256(JSON.stringify({applicationId:input.applicationId,model:MODEL,criteria,sources}));
    const cacheKey=`ai_review_v1_${hash}`;
    let cache=await deps.store.setting<Cache|null>(cacheKey,null);
    let review=cache?.status==="complete"&&cache.review?validateReview(cache.review,sources,criteria):undefined;
    const cached=!!review;
    if(review&&application.notes.some(note=>note.text===reviewNote(review!,hash)))return jsonResponse({data:{review,application,model:MODEL,cached:true}});
    if(application.revision!==input.expectedRevision)throw new HiringError("application_conflict",409,"The application changed. Refresh it before running AI review.");
    if(!review){
      await limit(deps.store,`ai:staff:${member.userId}`,30);
      await limit(deps.store,`ai:application:${input.applicationId}`,10);
      const claimed=await deps.store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE hub_settings.updated_at<? AND json_extract(hub_settings.value,'$.status')!='complete' RETURNING key",cacheKey,JSON.stringify({status:"pending"}),Date.now(),Date.now()-90000).first();
      if(!claimed){
        cache=await deps.store.setting<Cache|null>(cacheKey,null);
        if(cache?.status==="complete"&&cache.review)review=validateReview(cache.review,sources,criteria);
        else throw new HiringError("ai_review_pending",409,"This review is already running or recently failed. Wait 90 seconds before retrying.");
      }else{
        try{
          review=await generateReview(await openToken(config.sealedKey,deps.encryptionKey),sources,criteria,deps.fetcher);
          await deps.store.setSetting(cacheKey,{status:"complete",review});
        }catch(error){await deps.store.setSetting(cacheKey,{status:"failed"});throw error;}
      }
    }
    const updated=await deps.store.action(input.applicationId,{action:"note",text:reviewNote(review!,hash),expectedRevision:input.expectedRevision},member);
    return jsonResponse({data:{review,application:updated,model:MODEL,cached}});
  }catch(error){return errorResponse(error);}
}
