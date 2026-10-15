import type { MatchDeps, AiConfig } from './matching';
import { hourlyRateWindow } from '../hiring/rate-window';

/** Read-only operational aggregates. No candidate content, decrypted keys or provider calls. */
export async function matchDiagnostics(deps:MatchDeps,jobId:string,now=Date.now()){
 const {store}=deps,job=await store.getJob(jobId);
 const [config,criteria,rows,applications,budget,lease,errors]=await Promise.all([
  store.setting<AiConfig>('ai_openrouter_config_v1',{enabled:false}),
  store.stmt('SELECT status,error,attempts,run_after,updated_at FROM hub_ai_criteria WHERE job_id=? AND form_version=?',jobId,job.formVersion).first<{status:string;error:string|null;attempts:number;run_after:number;updated_at:number}>(),
  store.rows<{status:string;count:number;next_retry:number|null;exhausted:number}>("SELECT status,COUNT(*) AS count,MIN(CASE WHEN attempts<5 AND status IN ('pending','failed','running') THEN run_after END) AS next_retry,SUM(CASE WHEN attempts>=5 AND status<>'ready' THEN 1 ELSE 0 END) AS exhausted FROM hub_ai_matches WHERE job_id=? AND form_version=? GROUP BY status",jobId,job.formVersion),
  store.stmt('SELECT COUNT(*) AS count FROM hub_applications WHERE job_id=?',jobId).first<{count:number}>(),
  store.stmt("SELECT attempts FROM hiring_rate_limits WHERE key_hash='ai-match-global' AND window=?",hourlyRateWindow(now)).first<{attempts:number}>(),
  store.stmt("SELECT updated_at FROM hub_settings WHERE key='ai_match_worker_lease'").first<{updated_at:number}>(),
  store.rows<{error:string;count:number}>("SELECT error,COUNT(*) AS count FROM hub_ai_matches WHERE job_id=? AND form_version=? AND error IS NOT NULL GROUP BY error ORDER BY count DESC LIMIT 5",jobId,job.formVersion),
 ]);
 const count=(status:string)=>rows.find(row=>row.status===status)?.count||0;
 const total=applications?.count||0,queued=rows.reduce((sum,row)=>sum+row.count,0);
 const used=budget?.attempts||0,remaining=Math.max(0,120-used),resetsAt=(Math.floor(now/3600000)+1)*3600000;
 const enabled=process.env.HOSTING_PLATFORM==='railway'||process.env.RAILWAY_DEPLOYMENT_ID?process.env.BACKGROUND_ENABLED!=='false':null;
 const safeError=(value:string|null|undefined)=>value&&/^[a-z0-9_]{1,100}$/.test(value)?value:value?'ai_match_failed':null;
 const reasons:string[]=[];
 if(!job.aiMatchEnabled)reasons.push('job_disabled');
 if(!config.enabled||!config.sealedKey)reasons.push('provider_not_configured');
 if(!deps.encryptionKey)reasons.push('encryption_key_missing');
 if(enabled===false)reasons.push('background_worker_disabled');
 if(!remaining)reasons.push('hourly_budget_exhausted');
 if(criteria?.status==='failed')reasons.push(criteria.attempts>=5?'criteria_retry_limit':'criteria_retry_scheduled');
 if(!criteria)reasons.push('criteria_not_queued');
 if(rows.some(row=>row.exhausted>0))reasons.push('applicant_retry_limit');
 if(count('needs_review'))reasons.push('resume_needs_review');
 const candidates=rows.map(row=>row.next_retry).filter((value):value is number=>value!==null);
 if(criteria&&criteria.status!=='ready'&&criteria.attempts<5)candidates.push(criteria.run_after);
 const nextRetryAt=candidates.length?Math.max(now,Math.min(...candidates),remaining?0:resetsAt):null;
 return {counts:{pending:count('pending'),running:count('running'),complete:count('ready'),failed:count('failed'),needsReview:count('needs_review'),notQueued:Math.max(0,total-queued),total},criteria:{status:criteria?.status||'not_queued',error:safeError(criteria?.error),attempts:criteria?.attempts||0,nextRetryAt:criteria&&criteria.status!=='ready'&&criteria.attempts<5?Math.max(now,criteria.run_after):null},budget:{limit:120,used,remaining,resetsAt},worker:{enabled,encryptionKeyConfigured:!!deps.encryptionKey,leaseUntil:lease&&lease.updated_at>now?lease.updated_at:null},nextRetryAt,reasons,errors:errors.map(item=>({code:safeError(item.error),count:item.count}))};
}
