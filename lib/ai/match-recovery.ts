import type {HubStore} from '../hub/store';

// One deployment recovery for the source-reference transport. Never reset completed
// evidence or manual-review outcomes, and never touch the shared provider budget.
export const MATCH_RECOVERY_KEY='ai_match_recovery:source_spans_v1';
const recoverable=['ai_invalid_response','ai_response_schema_invalid','ai_response_criteria_mismatch','ai_response_citation_policy','ai_response_quote_unverified','ai_response_truncated','ai_response_incomplete','ai_response_json_invalid','ai_request_timeout','ai_review_failed'];
type Recovery={cutoff:number;complete:boolean;recovered:number};
export async function recoverLegacyMatches(store:HubStore,now=Date.now()) {
 // Called only while holding the existing global AI worker lease.
 let state=await store.setting<Recovery|null>(MATCH_RECOVERY_KEY,null);
 if(state?.complete)return 0;
 if(!state){state={cutoff:now,complete:false,recovered:0};await store.setSetting(MATCH_RECOVERY_KEY,state);}
 const conditions=`m.updated_at<=? AND ((m.status='failed' AND m.error IN (${recoverable.map(()=>'?').join(',')})) OR (m.status='running' AND COALESCE(m.lease_until,0)<=?))`;
 const rows=await store.rows<{application_id:string;form_version:number;status:string;error:string|null}>(`SELECT m.application_id,m.form_version,m.status,m.error FROM hub_ai_matches m JOIN hub_jobs j ON j.id=m.job_id AND j.form_version=m.form_version WHERE ${conditions} ORDER BY m.updated_at,m.application_id LIMIT 100`,state.cutoff,...recoverable,now);
 // An old worker may still own a live row lease. Keep the migration open until
 // that lease expires or its result is written; never steal live work.
 const waiting=await store.stmt("SELECT COUNT(*) AS n FROM hub_ai_matches m JOIN hub_jobs j ON j.id=m.job_id AND j.form_version=m.form_version WHERE m.updated_at<=? AND m.status='running' AND m.lease_until>?",state.cutoff,now).first<{n:number}>();
 const next={...state,recovered:state.recovered+rows.length,complete:rows.length<100&&!waiting?.n};
 const updatedAt=Math.max(now,state.cutoff+1);
 await store.db.batch([
  ...rows.map(row=>store.stmt("UPDATE hub_ai_matches SET status='pending',error=NULL,attempts=0,run_after=0,lease_token=NULL,lease_until=NULL,updated_at=? WHERE application_id=? AND form_version=? AND status=? AND updated_at<=?",updatedAt,row.application_id,row.form_version,row.status,state!.cutoff)),
  store.settingStatement(MATCH_RECOVERY_KEY,next),
  ...(rows.length?[store.stmt("INSERT INTO hub_audit(id,type,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)",crypto.randomUUID(),'ai_queue_recovery','System',JSON.stringify({version:'source_spans_v1',cutoff:state.cutoff}),JSON.stringify({recoveredThisBatch:rows.length,recoveredTotal:next.recovered,errorCounts:rows.reduce<Record<string,number>>((counts,row)=>{const key=row.error||'expired_running';counts[key]=(counts[key]||0)+1;return counts;},{})}),now)]:[]),
 ]);
 return rows.length;
}
