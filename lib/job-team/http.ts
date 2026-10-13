import { z } from "zod";
import type { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { parse } from "../hub/validation";
import { activeJobStaff,jobTeam,teamKey,teamInputSchema,validateTeam } from "./service";
const command=teamInputSchema.extend({jobId:z.string().min(1).max(200),expectedRevision:z.number().int().min(0)});
export async function handleJobTeam(request:Request,member:HubMember|null,store:HubStore,owners:string[]=[]){
 try{
  if(!member)throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring account.");
  let jobId=new URL(request.url).searchParams.get("jobId");
  if(request.method==="PUT"){
   assertSameOrigin(request);
   let raw;try{raw=JSON.parse(new TextDecoder().decode(await boundedBytes(request,16000)));}catch{throw new HiringError("invalid_request",400,"The hiring team could not be read.");}
   const {jobId:id,expectedRevision,...input}=parse(command,raw);jobId=id;
   await store.getJob(id);
   const previous=await jobTeam(store,id);
   if((previous?.revision||0)!==expectedRevision)throw new HiringError("job_team_changed",409,"This hiring team changed. Refresh before saving.");
   const validated=await validateTeam(store,input,owners),now=Date.now(),next={...validated,revision:expectedRevision+1,createdAt:previous?.createdAt||now,updatedAt:now};
   const saved=await store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(hub_settings.value,'$.revision')=? RETURNING key",teamKey(id),JSON.stringify(next),now,expectedRevision).first();
   if(!saved)throw new HiringError("job_team_changed",409,"Another manager changed this hiring team. Refresh before saving.");
  }else if(request.method!=="GET")throw new HiringError("method_not_allowed",405,"Use GET or PUT.");
  if(jobId)await store.getJob(jobId);
  return jsonResponse({data:{config:jobId?await jobTeam(store,jobId):null,staff:await activeJobStaff(store,owners),sender:await store.setting("google_sender","")}});
 }catch(error){return errorResponse(error);}
}
