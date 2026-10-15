import { matchDiagnostics } from './match-diagnostics';
import { z } from 'zod';
import type { HubMember } from '../hub/auth-core';
import { parse } from '../hub/validation';
import { boundedBytes } from '../hiring/files';
import { assertSameOrigin,errorResponse,jsonResponse } from '../hiring/http';
import { HiringError } from '../hiring/errors';
import { matchDetail,matchJobStatus,reconcileMatches,type MatchDeps } from './matching';
const enableInput=z.object({jobId:z.string().min(1).max(128),enabled:z.boolean(),expectedVersion:z.number().int().positive(),consent:z.boolean().optional()}).strict();
const queueInput=z.object({jobId:z.string().min(1).max(128)}).strict();
export async function handleAiMatch(request:Request,member:HubMember|null,deps:MatchDeps){
 try{
  if(!member||!['admin','recruiter'].includes(member.role))throw new HiringError('staff_access_required',403,'Sign in to your hiring account.');
  if(!['GET','PATCH','POST'].includes(request.method))throw new HiringError('method_not_allowed',405,'Use the AI matching settings.');
  if(request.method==='GET'){
   const params=new URL(request.url).searchParams,jobId=params.get('jobId'),applicationId=params.get('applicationId');
   if((!jobId&&!applicationId)||(jobId&&applicationId)||(jobId||applicationId||'').length>128)throw new HiringError('invalid_request',422,'Choose one job or application.');
   return jsonResponse({data:applicationId?await matchDetail(deps.store,applicationId):{...await matchJobStatus(deps.store,jobId!),...(member.role==='admin'?{diagnostics:await matchDiagnostics(deps,jobId!)}:{})}});
  }
  assertSameOrigin(request);
  let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(await boundedBytes(request,4096)));}catch{throw new HiringError('invalid_request',400,'The request could not be read.');}
  if(request.method==='PATCH'){
   const input=parse(enableInput,raw);const current=await deps.store.getJob(input.jobId);
   if(current.formVersion!==input.expectedVersion)throw new HiringError('job_conflict',409,'The job changed. Refresh before changing AI matching.');
   if(input.enabled&&input.consent!==true)throw new HiringError('ai_consent_required',422,'Confirm sharing job-related résumé and answer text with OpenRouter and OpenAI.');
   const changed=await deps.store.stmt('UPDATE hub_jobs SET ai_match_enabled=?,form_version=form_version+1,updated_at=? WHERE id=? AND form_version=?',input.enabled?1:0,Date.now(),input.jobId,current.formVersion).run();
   if(changed.meta.changes!==1)throw new HiringError('job_conflict',409,'The job changed. Refresh before changing AI matching.');
   return jsonResponse({data:await matchJobStatus(deps.store,input.jobId)});
  }
  const input=parse(queueInput,raw),job=await deps.store.getJob(input.jobId);
  if(!job.aiMatchEnabled)throw new HiringError('ai_match_disabled',409,'Enable AI matching for this job first.');
  // Explicit retry is bounded to once per minute for this posting; completed results are never rerun.
  const budget=await deps.store.stmt("INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES(?,?,1) ON CONFLICT(key_hash,window) DO NOTHING RETURNING attempts",`ai-match-retry:${job.id}`,Math.floor(Date.now()/60000)).first();
  if(!budget)throw new HiringError('ai_retry_limited',429,'Wait a minute before requesting another retry.');
  await deps.store.db.batch([
   deps.store.stmt("UPDATE hub_ai_criteria SET status='pending',attempts=0,run_after=0,error=NULL WHERE job_id=? AND form_version=? AND status IN ('failed','needs_review')",job.id,job.formVersion),
   deps.store.stmt("UPDATE hub_ai_matches SET status='pending',attempts=0,run_after=0,error=NULL WHERE job_id=? AND form_version=? AND status IN ('failed','needs_review')",job.id,job.formVersion)
  ]);
  await reconcileMatches(deps.store);
  return jsonResponse({data:await matchJobStatus(deps.store,job.id)});
 }catch(error){return errorResponse(error);}
}
