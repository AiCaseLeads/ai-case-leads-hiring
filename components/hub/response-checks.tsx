"use client";
import { useId, useState } from "react";
import type { ResponseEntry } from "../../lib/hiring/response-entry";
import type { getResponseCoverage, getResponseChecks } from "../../lib/response-checks/store";
import type { ResponseListItem } from "../../lib/response-checks/report";
import type { ResponseState } from "../../lib/response-checks/report-status";
import { displayDate, hubRequest, useHubResource } from "./api";
import { applicantHref } from "./navigation-link";
import { ResourceState } from "./shared";

type Checks = Awaited<ReturnType<typeof getResponseChecks>> & {entry:ResponseEntry|null};
type List = {items:ResponseListItem[];total:number;page:number;pageSize:number;coverage:Awaited<ReturnType<typeof getResponseCoverage>>};
const stateLabels:Record<ResponseState,string> = {
  pending:"Pending", ready:"Complete", no_written_answers:"No written answers", partial:"Some checks unavailable",
};
const classificationLabels:Record<string,string> = {
  AI_ONLY:"Resembles AI-written text", MIXED:"Resembles mixed-source text", HUMAN_ONLY:"Resembles human-written text", UNDETERMINED:"Unable to determine",
};
function duration(ms:number) {
  const seconds=Math.round(ms/1000);
  if(seconds<60) return seconds+" sec";
  return Math.floor(seconds/60)+" min "+seconds%60+" sec";
}

function AnswerChecks({applicationId}:{applicationId:string}) {
  const checks=useHubResource<Checks>("/api/hub/applications/"+encodeURIComponent(applicationId)+"/response-checks");
  const data=checks.data;
  return <div className="response-check-results">
    <ResourceState loading={checks.loading} error={checks.error} retry={()=>void checks.reload()}/>
    {data && Array.isArray(data.answers) && <>
      <div className="response-check-summary">
        <span>{data.answers.length} written {data.answers.length===1?"answer":"answers"} · {data.answers.reduce((n,a)=>n+a.words,0).toLocaleString()} words</span>
        <span>{data.entry?.formElapsedMs!=null ? "Form open to submission: "+duration(data.entry.formElapsedMs) : "Form timing unavailable"}</span>
        {data.entry?.firstEditToSubmitMs!=null && <span>First written edit to submission: {duration(data.entry.firstEditToSubmitMs)}</span>}
      </div>
      <p className="hub-muted">GPTZero’s estimates are experimental. Timing and editing activity are reported by the browser. These checks do not determine authorship or affect hiring stages.</p>
      {!data.answers.length && <p>No written responses to check.</p>}
      {data.answers.map(answer=>{
        const events=data.entry?.fields.find(field=>field.path===answer.path);
        const label=answer.status==="too_short" ? "Too short to assess" : answer.status==="unavailable" ? "Assessment unavailable" : answer.status==="ready" ? classificationLabels[answer.classification || ""] || "Unable to determine" : "Assessment pending";
        return <article key={answer.path} className="response-check-answer">
          <h4>{answer.title}</h4>
          <p className="response-check-prose">{answer.text || "No answer supplied."}</p>
          <p><strong>GPTZero estimate</strong> · {label}{answer.status==="ready" && !!answer.confidence && " · "+answer.confidence.toLowerCase()+" confidence"}</p>
          {events && events.pasteAttempts>0 && <p>Reported paste attempts · {events.pasteAttempts}</p>}
          {events && events.largeInsertions>0 && <p>Large text insertions · {events.largeInsertions} · largest {events.largestInsertionChars} characters</p>}
          {!!answer.matches.length && <details><summary>Matching passages ({answer.matches.length})</summary>
            {answer.matches.map((match,index)=><div key={match.applicationId+"-"+index}><blockquote>{match.passage}</blockquote><a href={applicantHref(match.applicationId)}>Open matching application · {match.jobTitle}</a></div>)}
          </details>}
        </article>;
      })}
    </>}
  </div>;
}

export function ResponseCheckPanel({applicationId}:{applicationId:string}) {
  const [open,setOpen]=useState(false);
  return <details className="response-check-panel" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Response checks</summary>
    {open && <AnswerChecks key={applicationId} applicationId={applicationId}/>}
  </details>;
}

function Connection({onSaved}:{onSaved:()=>void}) {
  const [secret,setSecret]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const id=useId();
  return <details className="response-check-panel"><summary>GPTZero connection</summary>
    <form className="response-check-connection" onSubmit={async event=>{
      event.preventDefault();
      if(busy || !secret.trim()) return;
      setBusy(true);setMessage("");
      try {await hubRequest("/api/hub/response-checks/connection","POST",{apiKey:secret.trim()});setSecret("");setMessage("Connection saved.");onSaved();}
      catch {setMessage("Could not save this connection. Check the key and try again.");}
      finally {setBusy(false);}
    }}>
      <p>Saving a key enables checks of eligible written answers from past and future applications using your GPTZero plan’s word allowance.</p>
      <label htmlFor={id}>GPTZero API key</label>
      <input id={id} type="password" autoComplete="off" spellCheck={false} value={secret} onChange={e=>setSecret(e.target.value)} disabled={busy} maxLength={512}/>
      <button className="hub-button secondary" type="submit" disabled={busy || !secret.trim()}>{busy?"Saving…":"Save connection"}</button>
      <span role="status">{message}</span>
    </form>
  </details>;
}

function ReviewPage({status,matches,page,setPage,refresh}:{status:string;matches:boolean;page:number;setPage:(page:number)=>void;refresh:number}) {
  const resource=useHubResource<List>("/api/hub/response-checks?"+new URLSearchParams({page:String(page),status,...(matches?{matches:"shared"}:{})}),refresh);
  const data=resource.data, coverage=data?.coverage;
  return <>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {coverage && <div className="response-check-progress" aria-label="All application checks">
      <p><strong>{coverage.indexed.toLocaleString()} of {coverage.total.toLocaleString()} applications indexed</strong> · {coverage.scannedAnswers.toLocaleString()} answers assessed · {coverage.pendingAnswers.toLocaleString()} awaiting assessment · {coverage.tooShort.toLocaleString()} too short · {coverage.unavailable.toLocaleString()} unavailable</p>
      {coverage.detectorState==="unconfigured" && <p>GPTZero is awaiting an API connection.</p>}
      {coverage.detectorState==="paused" && <p>{coverage.pauseReason==="quota"?"Pending answers exceed the remaining GPTZero word allowance.":coverage.pauseReason==="allowance_unavailable"?"GPTZero’s word allowance could not be verified. Assessments are paused.":"GPTZero assessments are paused."}{coverage.retryAt ? " Next retry "+displayDate(coverage.retryAt)+"." : " Check the API connection."}</p>}
    </div>}
    {data && Array.isArray(data.items) && <>
      <p className="hub-muted">{data.total.toLocaleString()} matching {data.total===1?"application":"applications"}</p>
      {data.items.length===0 && <p>No applications on this page.</p>}
      {data.items.map(item=><AppReviewRow key={item.id} application={item}/>)}
      {(page>1 || data.total>page*data.pageSize) && <nav className="response-check-pages" aria-label="Response check pages">
        <button className="hub-button secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</button>
        <span>Page {page} of {Math.max(page,Math.ceil(data.total/data.pageSize))}</span>
        <button className="hub-button secondary" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(page+1)}>Next</button>
      </nav>}
    </>}
  </>;
}

function AppReviewRow({application}:{application:ResponseListItem}) {
  const [open,setOpen]=useState(false);
  return <details className="response-check-app" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><span><strong>{application.name}</strong><small>{application.jobTitle}</small></span><span>{stateLabels[application.status]}</span></summary>
    {open && <div className="response-check-detail"><a href={applicantHref(application.id)}>Open applicant profile</a>
      <AnswerChecks applicationId={application.id}/>
    </div>}
  </details>;
}

export function ResponseCheckReport({refresh,isOwner}:{refresh:number;isOwner:boolean}) {
  const [status,setStatus]=useState(""),[matches,setMatches]=useState(false),[page,setPage]=useState(1),[version,setVersion]=useState(0);
  return <section className="hub-card response-check-report" aria-label="Written response review">
    <div className="response-check-heading"><h3>Written response review</h3>
      <label>Processing status<select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}>
        <option value="">All applications</option>{Object.entries(stateLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="response-check-match"><input type="checkbox" checked={matches} onChange={e=>{setMatches(e.target.checked);setPage(1);}}/>Matching passages only</label>
    </div>
    {isOwner && <Connection onSaved={()=>setVersion(v=>v+1)}/>}
    <ReviewPage key={page+"-"+status+"-"+matches} matches={matches} page={page} status={status} setPage={setPage} refresh={refresh+version}/>
  </section>;
}
