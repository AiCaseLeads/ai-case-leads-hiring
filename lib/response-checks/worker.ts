import type { HubStore } from "../hub/store";
import { activeApplicationsSql } from "../hub/application-lifecycle";
import { sha256 } from "../hiring/crypto";
import { canScan, detectorHash, passageAnchors, writtenAnswers, type Submission } from "./answers";
import { countWords } from "../hiring/word-count";
import { DetectorError, getDetectorAllowance, scanAnswer } from "./gptzero";
import { getDetectorKey } from "./key";

import { providerStateKey, type ProviderState } from "./store";

type Dependencies={store:HubStore; scan?:typeof scanAnswer; key?:typeof getDetectorKey; allowance?:typeof getDetectorAllowance; now?:()=>number; shouldStop?:()=>boolean};
const leaseMs=120_000;
const pauseFloor=30_000;
const indexPage=25;
const scanPage=8;

const expandedCoverageKey = "response_checks_expanded_coverage_v1";

async function schedulePreviouslySkippedAnswers(store: HubStore, now: number) {
  if (await store.setting<boolean>(expandedCoverageKey, false)) return;
  // Keep cached results and passage evidence while the existing indexer
  // reindexes written fields against the updated privacy and length rules.
  await store.db.batch([
    store.stmt(`UPDATE hub_response_index SET indexed_at=0 WHERE application_id IN (
      SELECT application_id FROM hub_response_answers
    ) AND NOT EXISTS (SELECT 1 FROM hub_settings WHERE key=?)`, expandedCoverageKey),
    store.stmt("INSERT OR IGNORE INTO hub_settings(key,value,updated_at) VALUES(?,'true',?)", expandedCoverageKey, now)
  ]);
}

async function indexApplication(store:HubStore,row:Submission, now:number) {
  const answers=await Promise.all(writtenAnswers(row).map(async answer=>({
    path:answer.path,title:answer.title,words:answer.words,hash:canScan(answer)?await detectorHash(answer):null,
    anchors:await passageAnchors(answer)
  })));
  const answerJson=JSON.stringify(answers.map(({path,title,words,hash})=>({path,title,words,hash})));
  const anchorRows=answers.flatMap(answer=>answer.anchors.map(anchor=>({...anchor,path:answer.path})));
  const statements=[
    store.stmt("INSERT INTO hub_response_index(application_id,indexed_at) VALUES(?,?) ON CONFLICT(application_id) DO UPDATE SET indexed_at=excluded.indexed_at WHERE hub_response_index.indexed_at=0",row.id,now),
    // Earlier versions could index free-text labels that requested personal
    // details. Remove those fields from both staff counts and peer matching.
    store.stmt("DELETE FROM hub_response_answers WHERE application_id=? AND path NOT IN (SELECT json_extract(value,'$.path') FROM json_each(?))",row.id,answerJson),
    store.stmt("DELETE FROM hub_response_passages WHERE application_id=? AND path NOT IN (SELECT json_extract(value,'$.path') FROM json_each(?))",row.id,answerJson),
    store.stmt("INSERT OR IGNORE INTO hub_response_detector_cache(answer_hash,status,updated_at) SELECT DISTINCT json_extract(value,'$.hash'),'pending',? FROM json_each(?) WHERE json_extract(value,'$.hash') IS NOT NULL",now,answerJson),
    store.stmt("INSERT INTO hub_response_answers(application_id,path,title,words,answer_hash) SELECT ?,json_extract(value,'$.path'),json_extract(value,'$.title'),json_extract(value,'$.words'),json_extract(value,'$.hash') FROM json_each(?) WHERE true ON CONFLICT(application_id,path) DO UPDATE SET answer_hash=excluded.answer_hash WHERE hub_response_answers.answer_hash IS NULL",row.id,answerJson)
  ];
  for(let i=0;i<anchorRows.length;i+=100){
    statements.push(store.stmt("INSERT OR IGNORE INTO hub_response_passages(application_id,path,passage_hash,excerpt) SELECT ?,json_extract(value,'$.path'),json_extract(value,'$.hash'),json_extract(value,'$.excerpt') FROM json_each(?)",row.id,JSON.stringify(anchorRows.slice(i,i+100))));
  }
  await store.db.batch(statements);
}

type CachedJob={answer_hash:string;attempts:number};
const activeRef=`EXISTS(SELECT 1 FROM hub_response_answers ar JOIN hub_applications a ON a.id=ar.application_id
    WHERE ar.answer_hash=c.answer_hash AND ${activeApplicationsSql("a")})`;
async function claimNext(store:HubStore,now:number,token:string) {
  return store.stmt(`UPDATE hub_response_detector_cache SET status='running',lease_token=?,run_after=?,updated_at=?
    WHERE answer_hash=(SELECT c.answer_hash FROM hub_response_detector_cache c
      WHERE c.status IN ('pending','running') AND c.run_after<=? AND ${activeRef} ORDER BY c.run_after,c.answer_hash LIMIT 1)
    RETURNING answer_hash,attempts`,token,now+leaseMs,now,now).first<CachedJob>();
}

export async function processResponseCheckBatch({store,scan=scanAnswer,key=getDetectorKey,allowance=getDetectorAllowance,now=Date.now,shouldStop=()=>false}:Dependencies) {
  await schedulePreviouslySkippedAnswers(store,now());
  const rows=await store.rows<Submission>(`SELECT a.id,a.name,a.email,a.fields_json,a.answers_json FROM hub_applications a
    WHERE ${activeApplicationsSql("a")} AND NOT EXISTS (SELECT 1 FROM hub_response_index r WHERE r.application_id=a.id AND r.indexed_at>0)
    ORDER BY a.created_at,a.id LIMIT ?`,indexPage);
  let indexed=0;
  for(const row of rows){
    if(shouldStop())break;
    await indexApplication(store,row,now());indexed++;
  }
  if(shouldStop() || rows.length===indexPage)return {indexed,scanned:0,hasMore:true};
  const apiKey=await key(store);
  const previous=await store.setting<ProviderState|null>(providerStateKey,null);
  if(!apiKey){
    if(previous?.state!=="unconfigured")await store.setSetting(providerStateKey,{state:"unconfigured"});
    return {indexed,scanned:0,hasMore:false};
  }
  const keyId=(await sha256(apiKey)).slice(0,24);
  if(previous?.keyId===keyId && previous.state==="paused" && (previous.retryAt||0)>now())return {indexed,scanned:0,hasMore:false};
  const ready=await store.stmt(`SELECT 1 AS present FROM hub_response_detector_cache c WHERE c.status IN ('pending','running') AND c.run_after<=? AND ${activeRef} LIMIT 1`,now()).first();
  if(!ready){
    if(previous?.keyId!==keyId || previous.state!=="active")await store.setSetting(providerStateKey,{state:"active",keyId});
    return {indexed,scanned:0,hasMore:false};
  }

  // Only one worker may draw from an allowance snapshot. A crashed batch
  // becomes eligible again after the lease and any in-flight request expire.
  const lockKey="response_checks_quota_lease", owner=crypto.randomUUID();
  const lock=await store.stmt(`INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
    WHERE hub_settings.updated_at<=? RETURNING key`,lockKey,owner,now()+leaseMs,now()).first();
  if(!lock)return {indexed,scanned:0,hasMore:false};
  try {
    let remaining:number;
    try{
      remaining=await allowance(apiKey);
      if (!Number.isSafeInteger(remaining) || remaining<0)throw new Error("Unusable allowance");
    }catch(error){
      const failure=error as {status?:number;retryAfterSeconds?:number};
      await store.setSetting(providerStateKey,{state:"paused",keyId,reason:"allowance_unavailable",httpStatus:failure.status,
        retryAt:now()+Math.max(60_000,(failure.retryAfterSeconds || 0)*1000)});
      return {indexed,scanned:0,hasMore:false};
    }
    if(remaining===0){
      await store.setSetting(providerStateKey,{state:"paused",keyId,reason:"quota",retryAt:now()+3_600_000});
      return {indexed,scanned:0,hasMore:false};
    }
    return await scanBatch(apiKey,remaining);
  }finally{
    await store.stmt("DELETE FROM hub_settings WHERE key=? AND value=?",lockKey,owner).run();
  }

  async function scanBatch(credential:string,remaining:number){
    if(previous?.keyId!==keyId || previous.state!=="active")await store.setSetting(providerStateKey,{state:"active",keyId});
    let quotaBlocked=false;
    let scanned=0, claimed=0, paused=false;
    async function consume(){
      while(!shouldStop() && !paused && claimed<scanPage){
        claimed++;
        const token=crypto.randomUUID();
        const job=await claimNext(store,now(),token);
        if(!job)return;
        try {
          const ref=await store.stmt(`SELECT a.id,a.name,a.email,a.fields_json,a.answers_json,ar.path FROM hub_response_answers ar
            JOIN hub_applications a ON a.id=ar.application_id WHERE ar.answer_hash=? AND ${activeApplicationsSql("a")} LIMIT 1`,job.answer_hash).first<Submission & {path:string}>();
          const answer=ref && writtenAnswers(ref).find(a=>a.path===ref.path);
          if(!answer || !canScan(answer) || await detectorHash(answer)!==job.answer_hash) {
            await store.stmt("UPDATE hub_response_detector_cache SET status='pending',run_after=?,lease_token=NULL WHERE answer_hash=? AND lease_token=?",now()+60_000,job.answer_hash,token).run();
            continue;
          }
          // Renew before every paid call. If ownership expired while waiting, leave
          // this row retryable without spending another worker's allowance.
          const renewed=await store.stmt("UPDATE hub_settings SET updated_at=? WHERE key=? AND value=? AND updated_at>?",
            now()+leaseMs,lockKey,owner,now()).run();
          const cost=Math.max(countWords(answer.sanitized),answer.sanitized.trim().split(/\s+/u).length);
          if (!renewed.meta.changes || paused || shouldStop() || cost>remaining){
            if(cost>remaining && renewed.meta.changes){quotaBlocked=true;paused=true;}
            await store.stmt("UPDATE hub_response_detector_cache SET status='pending',run_after=?,lease_token=NULL WHERE answer_hash=? AND lease_token=?",now(),job.answer_hash,token).run();
            return;
          }
          // Synchronous reservation before either consumer can begin another call.
          remaining-=cost;
          const result=await scan(answer.sanitized,credential);
          await store.stmt("UPDATE hub_response_detector_cache SET status='ready',classification=?,confidence=?,updated_at=?,lease_token=NULL WHERE answer_hash=? AND lease_token=?",result.classification,result.confidence,now(),job.answer_hash,token).run();
          scanned++;
        }catch(error){
          if(error instanceof DetectorError && error.reason==="too_short") {
            // Preserve an explicit provider refusal so duplicate answers share
            // the same terminal result without consuming further quota.
            await store.stmt("UPDATE hub_response_detector_cache SET status='unavailable',classification='TOO_SHORT',confidence=NULL,lease_token=NULL,updated_at=? WHERE answer_hash=? AND lease_token=?",now(),job.answer_hash,token).run();
            continue;
          }
          const failure=error as {status?:number;retryAfterSeconds?:number};
          const http=failure?.status||503;
          const globalPause=[401,402,403,429].includes(http);
          const auth=[401,402,403].includes(http);
          const attempts=globalPause?job.attempts:job.attempts+1;
          const delay=Math.max((failure?.retryAfterSeconds||0)*1000,auth?3_600_000:Math.min(900_000,pauseFloor*2**Math.min(attempts,5)));
          const retryAt=now()+delay;
          if(globalPause) {
            paused=true;
            await store.setSetting(providerStateKey,{state:"paused",keyId,retryAt,httpStatus:http});
          }
          const permanent=!globalPause && (http===400 || http===413 || http===422 || attempts>=5);
          await store.stmt("UPDATE hub_response_detector_cache SET status=?,attempts=?,run_after=?,lease_token=NULL,updated_at=? WHERE answer_hash=? AND lease_token=?",permanent?"unavailable":"pending",attempts,auth?now():retryAt,now(),job.answer_hash,token).run();
        }
      }
    }
    await Promise.all([consume(),consume()]);
    if(quotaBlocked)await store.setSetting(providerStateKey,{state:"paused",keyId,reason:"quota",retryAt:now()+3_600_000});
    return {indexed,scanned,hasMore:!paused && scanned>0 && claimed>=scanPage};
  }
}
