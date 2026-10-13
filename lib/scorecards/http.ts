import { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import { parse } from "../hub/validation";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { boundTemplate,calculateScore,configInput,emptyCatalog,reviewInput,snapshotText,type Catalog } from "./model";
const KEY="scorecard_templates_v1";
async function body(request:Request){try{return JSON.parse(new TextDecoder().decode(await boundedBytes(request,64*1024)));}catch(e){if(e instanceof HiringError)throw e;throw new HiringError("invalid_request",400,"The request could not be read.");}}
function staff(member:HubMember|null):asserts member is HubMember{if(!member||!["admin","recruiter"].includes(member.role))throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring account.");}
export async function handleScorecards(request:Request,member:HubMember|null,store:HubStore){try{
 staff(member);const catalog=await store.setting<Catalog>(KEY,structuredClone(emptyCatalog));
 if(request.method==="GET"){
  const jobId=new URL(request.url).searchParams.get("jobId");
  if(jobId){await store.getJob(jobId);return jsonResponse({data:{template:boundTemplate(catalog,jobId)||null,revision:catalog.revision}});}
  return jsonResponse({data:catalog});
 }
 if(request.method!=="PATCH")throw new HiringError("method_not_allowed",405,"Use the scorecard form.");
 assertSameOrigin(request);
 const input=parse(configInput,await body(request));
 if(input.expectedRevision!==catalog.revision)throw new HiringError("scorecard_conflict",409,"Scorecards changed. Refresh templates before saving; your draft remains here.");
 if(input.action==="save"){
  const prior=input.templateId?catalog.templates.filter(t=>t.id===input.templateId):[];
  if(input.templateId&&(!prior.length||catalog.archived.includes(input.templateId)))throw new HiringError("template_unavailable",409,"This template is archived or unavailable. Create a new template.");
  if(catalog.templates.length>=1000)throw new HiringError("template_limit",422,"The scorecard version limit was reached. Contact an administrator.");
  catalog.templates.push({...input.rubric,id:input.templateId||crypto.randomUUID(),version:prior.length?Math.max(...prior.map(t=>t.version))+1:1,createdBy:member.email,createdAt:Date.now()});
 }else if(input.action==="archive"){
  if(!catalog.templates.some(t=>t.id===input.templateId))throw new HiringError("template_unavailable",404,"Template not found.");
  if(!catalog.archived.includes(input.templateId))catalog.archived.push(input.templateId);
 }else{
  await store.getJob(input.jobId);
  if(input.templateId===null)delete catalog.bindings[input.jobId];
  else{
   const template=catalog.templates.find(t=>t.id===input.templateId&&t.version===input.version);
   if(!template||catalog.archived.includes(template.id))throw new HiringError("template_unavailable",409,"Choose an available template version.");
   catalog.bindings[input.jobId]={templateId:template.id,version:template.version};
  }
 }
 const priorRevision=catalog.revision;catalog.revision++;catalog.updatedBy=member.email;catalog.updatedAt=Date.now();
 const updated=await store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(hub_settings.value,'$.revision')=? RETURNING key",KEY,JSON.stringify(catalog),Date.now(),priorRevision).first();
 if(!updated)throw new HiringError("scorecard_conflict",409,"Another manager changed scorecards. Refresh templates before saving.");
 return jsonResponse({data:catalog});
 }catch(error){return errorResponse(error);}}
export async function handleScorecardReview(request:Request,member:HubMember|null,store:HubStore){try{
 staff(member);if(request.method!=="POST")throw new HiringError("method_not_allowed",405,"Use the scorecard review form.");assertSameOrigin(request);
 const input=parse(reviewInput,await body(request)),application=await store.getApplication(input.applicationId),catalog=await store.setting<Catalog>(KEY,structuredClone(emptyCatalog));
 const template=boundTemplate(catalog,application.jobId);
 if(!template||template.id!==input.templateId||template.version!==input.version)throw new HiringError("template_changed",409,"This job posting’s assigned scorecard changed. Reload its scorecard before submitting.");
 if(input.ratings.length!==template.criteria.length)throw new HiringError("ratings_required",422,"Score every criterion and add supporting evidence.");
 const score=calculateScore(template,input.ratings),text=snapshotText(template,input.ratings),criteria=`${template.name} · version ${template.version}: ${template.criteria.map(c=>c.label).join("; ")}`;
 // An uncertain network response can be retried without adding a second review.
 const latest=application.scorecards.find(c=>c.actor.toLowerCase()===member.email.toLowerCase());
 if(latest?.text===text&&latest.criteria===criteria)return jsonResponse({data:application});
 return jsonResponse({data:await store.action(application.id,{action:"scorecard",expectedRevision:input.expectedRevision,score:score.overall,criteria,text},member)});
 }catch(error){return errorResponse(error);}}
