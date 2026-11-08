import { HiringError } from "../hiring/errors";
import { activeApplicationsSql } from "../hub/application-lifecycle";
import type { HubStore } from "../hub/store";
import { writtenAnswers, canScan, type Submission } from "./answers";
import { appCheckJoinsSql, appCheckStatusSql, type ResponseState } from "./report-status";

export const providerStateKey="response_checks_provider_state";
export type ProviderState={state:"active"|"unconfigured"|"paused";keyId?:string;retryAt?:number;httpStatus?:number};
type StatusRow={status:ResponseState;total:number};
type AnswerState="ready"|"pending"|"too_short"|"unavailable";
type Match={applicationId:string;jobTitle:string;passage:string};
type AnswerDetail={path:string;title:string;text:string;words:number;status:AnswerState;classification:string|null;confidence:string|null;matches:Match[]};
export async function getResponseCoverage(store:HubStore) {
  const apps=await store.rows<StatusRow>(`SELECT ${appCheckStatusSql} AS status,COUNT(*) AS total FROM hub_applications a
    ${appCheckJoinsSql} WHERE ${activeApplicationsSql("a")} GROUP BY 1`);
  const answers=await store.stmt(`SELECT COUNT(*) FILTER(WHERE ar.answer_hash IS NULL) AS tooShort,
    COUNT(*) FILTER(WHERE c.status='ready') AS scannedAnswers,
    COUNT(*) FILTER(WHERE c.status IN ('pending','running')) AS pendingAnswers,
    COUNT(*) FILTER(WHERE c.status='unavailable') AS unavailable
    FROM hub_response_answers ar JOIN hub_applications a ON a.id=ar.application_id LEFT JOIN hub_response_detector_cache c ON c.answer_hash=ar.answer_hash
    WHERE ${activeApplicationsSql("a")}`).first<{tooShort:number;scannedAnswers:number;pendingAnswers:number;unavailable:number}>();
  const indexed=await store.stmt(`SELECT COUNT(*) AS n FROM hub_response_index r JOIN hub_applications a ON a.id=r.application_id WHERE ${activeApplicationsSql("a")}`).first<{n:number}>();
  const state=await store.setting<ProviderState>(providerStateKey,{state:"unconfigured"});
  const counts=Object.fromEntries(apps.map(row=>[row.status,row.total]));
  return {total:apps.reduce((n,v)=>n+v.total,0),indexed:indexed?.n||0,pending:counts.pending||0,ready:counts.ready||0,
    partial:counts.partial||0,noWritten:counts.no_written_answers||0,tooShort:answers?.tooShort||0,
    unavailable:answers?.unavailable||0,scannedAnswers:answers?.scannedAnswers||0,pendingAnswers:answers?.pendingAnswers||0,
    detectorState:state.state,retryAt:state.retryAt??null};
}

export async function getResponseChecks(store:HubStore,id:string):Promise<{status:ResponseState;answers:AnswerDetail[]}> {
  const app=await store.stmt(`SELECT a.id,a.name,a.email,a.fields_json,a.answers_json,ri.indexed_at AS indexedAt
    FROM hub_applications a LEFT JOIN hub_response_index ri ON ri.application_id=a.id WHERE a.id=? AND ${activeApplicationsSql("a")}`,id).first<Submission&{indexedAt:number|null}>();
  if(!app)throw new HiringError("application_not_found",404,"This application is unavailable.");
  const checks=await store.rows<{path:string;status:string|null;classification:string|null;confidence:string|null;answer_hash:string|null}>(`
    SELECT ra.path,ra.answer_hash,c.status,c.classification,c.confidence FROM hub_response_answers ra
    LEFT JOIN hub_response_detector_cache c ON c.answer_hash=ra.answer_hash WHERE ra.application_id=?`,id);
  const results=new Map(checks.map(row=>[row.path,row]));
  // Bound common hash matches before grouping. Comparison is between different
  // email identities and excludes trash even if either record was indexed earlier.
  const evidence=await store.rows<{path:string}&Match>(`SELECT local.path,peer.application_id AS applicationId,
    a.job_title AS jobTitle,MIN(local.excerpt) AS passage
    FROM hub_response_passages local
    JOIN hub_response_passages peer ON peer.rowid IN (
      SELECT p.rowid FROM hub_response_passages p JOIN hub_applications other ON other.id=p.application_id
      WHERE p.passage_hash=local.passage_hash AND p.application_id<>local.application_id
        AND (?='' OR lower(trim(other.email))<>?) AND ${activeApplicationsSql("other")}
      ORDER BY p.application_id LIMIT 5)
    JOIN hub_applications a ON a.id=peer.application_id WHERE local.application_id=?
    GROUP BY local.path,peer.application_id ORDER BY local.path,peer.application_id`,app.email.trim().toLowerCase(),app.email.trim().toLowerCase(),id);
  const byPath=new Map<string,Match[]>();
  for(const {path,...item} of evidence){
    const group=byPath.get(path)||[];
    if(group.length<5) group.push(item);
    byPath.set(path,group);
  }
  const answers=writtenAnswers(app).map(({path,title,text,words,...rest}):AnswerDetail=>{
    const result=results.get(path);
    const eligible=result?!!result.answer_hash:canScan({path,title,text,words,...rest});
    const status=!eligible?"too_short":result?.status==="ready"?"ready":result?.status==="unavailable"?"unavailable":"pending";
    return {path,title,text,words,status,classification:result?.classification||null,confidence:result?.confidence||null,matches:byPath.get(path)||[]};
  });
  const status=app.indexedAt===null || answers.some(a=>a.status==="pending")?"pending"
    :!answers.length?"no_written_answers":answers.some(a=>a.status==="unavailable")?"partial":"ready";
  return {status,answers};
}
