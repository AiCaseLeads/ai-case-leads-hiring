"use client";
import { useEffect } from "react";
import { useHubMutation, useHubResource } from "./api";
import { Feedback, ResourceState } from "./shared";

export type MatchSummary = {status: string; score: number | null; updatedAt?: number | null};
type MatchDetail = MatchSummary & {model?: string; error?: string; sourceWarnings?: string[]; criteria?: {criterion: string; status: string; explanation: string; citations: {source: string; quote: string}[]}[]};
type MatchJob = {enabled: boolean; jobId: string; version: number; available?: boolean; criteria: string[]; status: string; error?: string};
const labels: Record<string,string> = {disabled:"AI review off",setup_required:"Connect AI in Company setup",pending:"Waiting for AI review",preparing:"Preparing job requirements",running:"AI review in progress",needs_review:"Needs manual review",failed:"AI review needs attention",stale:"Job changed · review needed"};
export function MatchScore({match}:{match?:MatchSummary}) {
  return match?.status === "ready" && typeof match.score === "number"
    ? <span><strong>{Math.round(match.score)} / 100</strong><span className="hub-secondary-line">Job-match evidence</span></span>
    : <span className="hub-muted">{labels[match?.status || "disabled"] || "Not reviewed"}</span>;
}
export function JobMatchSetup({jobId, changed}:{jobId:string;changed:()=>void}) {
  const resource=useHubResource<MatchJob>("/api/ai/match?jobId="+encodeURIComponent(jobId));
  const mutation=useHubMutation();
  async function toggle(enabled:boolean) {
    const result=await mutation.run("/api/ai/match","PATCH",{jobId,enabled,expectedVersion:resource.data?.version,consent:true},enabled?"AI matching enabled for this posting.":"Automatic AI matching is off for this posting.");
    if(result!==undefined){await resource.reload();changed();}
  }
  async function queue() {
    const result=await mutation.run("/api/ai/match","POST",{jobId},"Applications queued for AI review. Results appear as background reviews finish.");
    if(result!==undefined){await resource.reload();changed();}
  }
  return <section className="hub-card" aria-label="AI matching for this job">
    <h3>AI matching for this job</h3>
    <p>Compare résumés and application answers with the same requirements from this job’s description. No scorecard setup needed.</p>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {resource.data && <>
      <label className="hub-checkbox"><input type="checkbox" checked={resource.data.enabled} disabled={mutation.busy || !resource.data.version} onChange={e=>void toggle(e.target.checked)}/> Automatically review applicants for this job</label>
      <p className="hub-muted">Enabling this sends relevant résumé text and answers to OpenRouter / OpenAI. Results help your team compare evidence; they do not make hiring decisions or send rejections. API usage is billed to your OpenRouter account.</p>
      {resource.data.error && <p role="alert" className="hub-notice hub-error">{resource.data.error}</p>}
      {resource.data.enabled && <><p>{labels[resource.data.status] || (resource.data.status === "ready" ? "Job requirements are ready." : resource.data.status)}</p><button type="button" className="hub-button secondary" disabled={mutation.busy || resource.data.available === false} onClick={()=>void queue()}>Review existing applicants</button><p className="hub-muted">Then choose “Highest AI match first” above and apply filters. Refresh the list to see completed reviews.</p></>}
      {!!resource.data.criteria?.length && <details><summary>Requirements used for every applicant</summary><ul>{resource.data.criteria.map(c=><li key={c}>{c}</li>)}</ul><p className="hub-muted">These come from the job description. Edit the job if its requirements need correction; older results must then be reviewed again.</p></details>}
    </>}
    <div className="hub-button-row"><button type="button" className="hub-button secondary" disabled={resource.loading || mutation.busy} onClick={()=>void resource.reload()}>Refresh AI settings</button></div>
    <Feedback error={mutation.error} success={mutation.success}/>
  </section>;
}
export function CandidateMatch({applicationId}:{applicationId:string}) {
  const resource=useHubResource<MatchDetail>("/api/ai/match?applicationId="+encodeURIComponent(applicationId));
  const reload=resource.reload;
  const pending=["pending","preparing","running"].includes(resource.data?.status || "");
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>void reload(),15000);return()=>clearInterval(timer);},[pending,reload]);
  return <section className="hub-card" aria-label="AI job match">
    <h3>AI job match</h3>
    <p>A comparison of the résumé and application answers against this job’s requirements.</p>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void reload()}/>
    {resource.data && <><MatchScore match={resource.data}/>
      {resource.data.error && <p role="alert">{resource.data.error}</p>}
      {resource.data.sourceWarnings?.map(w=><p className="hub-notice" key={w}>{w}</p>)}
      {resource.data.status==="disabled" && <p>Enable AI matching under Applications after selecting this job, or in the job’s AI review step.</p>}
      <p className="hub-muted">The score measures supported job requirements, not a probability of success. Missing evidence is not proof of missing ability. Check the original files and speak with the candidate before deciding.</p>
      {!!resource.data.criteria?.length && <div>{resource.data.criteria.map((c,i)=><article className="hub-history-item" key={i}><strong>{c.criterion}</strong><p>{c.status==="evidence_found"?"Evidence found":c.status==="needs_verification"?"Needs clarification":"Evidence not found"} — {c.explanation}</p>{c.citations.map((q,n)=><blockquote key={n}><p>{q.quote}</p><small>Source: {q.source}</small></blockquote>)}</article>)}</div>}
      <small>{resource.data.model ? `Model: ${resource.data.model}. ` : ""}{resource.data.updatedAt ? `Reviewed ${new Date(resource.data.updatedAt).toLocaleString()}.` : ""}</small>
    </>}
    <div className="hub-button-row"><button type="button" className="hub-button secondary" disabled={resource.loading} onClick={()=>void reload()}>Refresh AI review</button></div>
  </section>;
}
