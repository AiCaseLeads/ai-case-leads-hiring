"use client";
import {useEffect,useRef,useState} from "react";
import {hubRequest} from "./api";
type Plan={planId:string;count:number;recipients?:number;excluded:number;expiresAt:number};
type Progress={updated:number;total:number;remaining:number;complete:boolean;skipped:number};
export function BulkRejection({filter,actor,disabled,jobTitle,selectedIds=[],selectionId,recoveryOnly=false,changed}:{
 filter:string;actor:string;disabled:boolean;jobTitle:string;selectedIds?:string[];selectionId?:string;recoveryOnly?:boolean;changed:()=>void;
}) {
 const [plan,setPlan]=useState<Plan|null>(null),[progress,setProgress]=useState<Progress|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [started,setStarted]=useState(false);
 const params=new URLSearchParams(filter);
 params.delete("page");params.sort();
 const canonicalFilter=params.toString();
 const currentScope=JSON.stringify({filter:canonicalFilter,ids:selectionId || selectedIds});
 const restoreScope=useRef(currentScope);
 const storageKey="hiring-bulk-rejection:v2:"+JSON.stringify([actor.toLowerCase(),canonicalFilter]);
 const [scope,setScope]=useState("");const running=useRef(false),mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;
  try {
    const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");
    const matching=recoveryOnly ? saved?.started===true && !saved.progress?.complete : saved?.scope===restoreScope.current;
    if(matching && typeof saved.plan?.planId==="string" && Number.isSafeInteger(saved.plan.count) && saved.plan.expiresAt>Date.now()){
      queueMicrotask(()=>{if(mounted.current){setScope(saved.scope);setPlan(saved.plan);setProgress(saved.progress||null);setStarted(!!saved.started);}});
    }
  }catch{/* Session storage is optional. */}
  return ()=>{mounted.current=false;};
 },[storageKey,recoveryOnly]);
 function remember(nextPlan:Plan,nextProgress:Progress|null,hasStarted:boolean,savedScope=scope){try{sessionStorage.setItem(storageKey,JSON.stringify({plan:nextPlan,progress:nextProgress,started:hasStarted,scope:savedScope}));}catch{}}
 function clear(){try{sessionStorage.removeItem(storageKey);}catch{}setPlan(null);setProgress(null);setStarted(false);setError("");}
 async function preview(){
  if(disabled||running.current||!selectedIds.length)return;running.current=true;setBusy(true);setError("");setProgress(null);setStarted(false);
  try{const params=new URLSearchParams(filter);params.delete("page");const result=await hubRequest<Plan>(`/api/hub/bulk-rejection/preview?${params}`,"POST",{reason:"Not selected after recruiter review.",...(selectionId?{selectionId}:{ids:selectedIds})});if(mounted.current){setScope(currentScope);setPlan(result);remember(result,null,false,currentScope);}}
  catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:"Could not preview these applicants.");}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 async function execute(){
  if(!plan||running.current||disabled||(!recoveryOnly && scope!==currentScope))return;running.current=true;setBusy(true);setError("");setStarted(true);remember(plan,progress,true);
  try{while(mounted.current){const result=await hubRequest<Progress>("/api/hub/bulk-rejection/execute","POST",{planId:plan.planId,confirmed:true});if(!mounted.current)return;setProgress(result);remember(plan,result,true);if(result.complete){changed();break;}}}
  catch(cause){if(mounted.current){setError(cause instanceof Error?cause.message:"Processing stopped. Retry this same selection to continue safely.");changed();}}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 const stale=!recoveryOnly && scope!==currentScope;
 if(recoveryOnly && !plan)return null;
 return <div className="hub-bulk-rejection">
  {!recoveryOnly&&<button type="button" className="hub-button secondary" disabled={disabled||busy||!selectedIds.length||started&&!progress?.complete} onClick={()=>void preview()}>Preview rejection for {selectedIds.length} selected</button>}
  {error&&<p role="alert">{error}</p>}
  {plan&&<section className="hub-card" aria-label="Confirm bulk rejection" style={{marginTop:12}}>
   <strong>{progress?.complete?"Bulk rejection completed":`Review ${plan.count.toLocaleString()} eligible applicants`}</strong>
   <p>{jobTitle} · {recoveryOnly?"Previously confirmed selection. Continuing resumes the same rejection.":"Selected applications within these filters."}</p>
   <p>Only applicants still in initial review who have never moved forward or received an interview are included. Shortlisted, interviewed, offered, hired, rejected, and withdrawn applicants are protected.</p>
   {!progress?.complete&&<p>{plan.count.toLocaleString()} eligible applications · {plan.count.toLocaleString()} rejection emails to {(plan.recipients ?? plan.count).toLocaleString()} distinct addresses · {plan.excluded.toLocaleString()} selected applications excluded.</p>}
   {progress&&<p role="status">{progress.updated.toLocaleString()} applicants rejected; emails queued. {progress.skipped.toLocaleString()} skipped because their records changed. {progress.remaining.toLocaleString()} remaining.</p>}
   {stale&&<p role="alert">Filters changed. Preview the updated selection before confirming.</p>}
   <div className="hub-button-row">
    {!progress?.complete&&<button type="button" className="hub-button" disabled={busy||!plan.count||(disabled||stale)} onClick={()=>void execute()}>{busy?"Processing…":started?"Continue this rejection safely":`Reject ${plan.count.toLocaleString()} and queue emails`}</button>}
    <button type="button" className="hub-text-button" disabled={busy} onClick={clear}>{progress?.complete?"Close":started?"Close recovery notice":"Cancel"}</button>
   </div>
  </section>}
 </div>;
}
