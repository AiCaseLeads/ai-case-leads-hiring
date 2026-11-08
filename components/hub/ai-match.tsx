"use client";
import { readableMatchExplanation } from "../../lib/hub/match-display";
import { useEffect } from "react";
import { useHubMutation, useHubResource } from "./api";
import { Feedback, ResourceState } from "./shared";

export type MatchSummary = {status: string; score: number | null; updatedAt?: number | null};
type MatchProgress={state:string;providerPauseReason?:string|null;attempts:number;readyAhead:number|null;nextRetryAt:number|null;hourlyLimit:number;capacityRemaining:number;capacityResetsAt:number};
type MatchDetail = MatchSummary & {progress?:MatchProgress;model?: string; error?: string; sourceWarnings?: string[]; criteria?: {criterion: string; status: string; explanation: string; citations: {source: string; quote: string}[]}[]};
type MatchDiagnostics = {errors?:{code:string|null;count:number}[];counts:{pending:number;running:number;complete:number;failed:number;needsReview:number;notQueued:number;total:number};criteria:{status:string;error?:string|null;attempts:number;nextRetryAt?:number|null};budget:{limit:number;used:number;remaining:number;resetsAt:number};worker:{enabled:boolean|null;encryptionKeyConfigured:boolean;leaseUntil?:number|null};nextRetryAt?:number|null;reasons:string[]};
type MatchJob = {diagnostics?:MatchDiagnostics;enabled: boolean; jobId: string; version: number; available?: boolean; criteria: string[]; status: string; error?: string};
const labels: Record<string,string> = {disabled:"AI review off",setup_required:"Connect AI in Company",pending:"Waiting for AI review",preparing:"Preparing job requirements",running:"AI review in progress",needs_review:"Needs manual review",failed:"AI review needs attention",stale:"Job changed · review needed"};
const diagnosticReasons: Record<string,string> = {
  job_disabled:"AI matching is off for this job.",
  provider_not_configured:"Connect and enable OpenRouter in Company before reviews can run.",
  encryption_key_missing:"The server encryption key is missing. Ask the administrator to check deployment settings.",
  background_worker_disabled:"Background processing is disabled. Ask the administrator to enable the worker.",
  hourly_budget_exhausted:"Hourly AI capacity is exhausted. Reviews will resume after reset.",
  criteria_retry_limit:"Preparing job requirements reached the retry limit. An administrator needs to investigate before retrying.",
  criteria_retry_scheduled:"Preparing job requirements failed temporarily; a retry is scheduled.",
  criteria_not_queued:"Job requirements have not been queued yet.",
  applicant_retry_limit:"Some applicant reviews reached the retry limit and need administrator attention.",
  resume_needs_review:"Some resumes could not be assessed automatically and need a recruiter’s review.",
};
const diagnosticErrors: Record<string,string> = {
  ai_provider_rate_limited:"OpenRouter is limiting requests. Reviews wait before retrying, so retrying repeatedly will not make them faster.",
  ai_provider_unauthorized:"OpenRouter did not accept the API key or model access. Ask an administrator to check the AI connection, then retry failed reviews.",
  ai_provider_credit_required:"OpenRouter needs credit before reviews can continue. Add credit, then retry failed reviews.",
  ai_hourly_capacity:"This hour’s AI processing limit was reached. Reviews will resume automatically after reset.",
  pdf_busy:"The PDF reader is processing another file. This review will retry shortly.",
  ai_provider_unavailable:"OpenRouter could not fulfill the request. Check the API key, credit balance and model access.",
  ai_response_truncated:"The provider stopped at its output limit before completing the review. No score was saved.",
  ai_response_refused:"The provider declined to complete this review. No score was saved; a recruiter can review the application manually.",
  ai_response_incomplete:"The provider returned an incomplete review. No score was saved.",
  ai_response_json_invalid:"The provider response could not be read as a valid review. No score was saved.",
  ai_request_timeout:"The provider did not respond before the request timed out. No score was saved.",
  ai_response_schema_invalid:"The AI response did not match the required review format. No score was saved.",
  ai_response_criteria_mismatch:"The AI response did not match this job’s requirements. No score was saved.",
  ai_response_citation_policy:"The AI response did not meet the evidence citation requirements. No score was saved.",
  ai_response_quote_unverified:"An AI quotation could not be verified against the submitted source text. No score was saved.",
  ai_invalid_response:"The AI response contained invalid or unsupported evidence. No score was saved.",
  ai_criteria_invalid:"Job requirements could not be verified against the description. Review the job description.",
  ai_job_description_required:"Add a detailed job description before reviewing applicants.",
  pdf_temporarily_unavailable:"Resume extraction or OCR was temporarily unavailable.",
  ai_match_failed:"The review did not finish. This may be a timeout or invalid provider response; inspect server logs for the cause.",
  ai_review_failed:"The provider review did not finish or returned an invalid response.",
  ai_not_configured:"OpenRouter is not configured or enabled in Company.",
};
function diagnosticError(code: string | null) {return diagnosticErrors[code || ""] || "The review failed. An administrator should inspect server logs using this error code.";}
export function MatchScore({match}:{match?:MatchSummary}) {
  return match?.status === "ready" && typeof match.score === "number"
    ? <span className="hub-ai-score"><strong>{Math.round(match.score)} / 100</strong></span>
    : <span className="hub-muted">{labels[match?.status || "disabled"] || "Not reviewed"}</span>;
}
export function JobMatchSetup({jobId, changed}:{jobId:string;changed:()=>void}) {
  const resource=useHubResource<MatchJob>("/api/ai/match?jobId="+encodeURIComponent(jobId));
  const mutation=useHubMutation();
  const refreshStatus=resource.reload;
  const outstanding=!!resource.data?.enabled&&(resource.data.status==='preparing'||!!resource.data.diagnostics&&(resource.data.diagnostics.counts.pending+resource.data.diagnostics.counts.running+resource.data.diagnostics.counts.failed+resource.data.diagnostics.counts.notQueued)>0);
  useEffect(()=>{if(!outstanding)return;const timer=setInterval(()=>void refreshStatus(),15000);return()=>clearInterval(timer);},[outstanding,refreshStatus]);
  async function toggle(enabled:boolean) {
    const result=await mutation.run("/api/ai/match","PATCH",{jobId,enabled,expectedVersion:resource.data?.version,consent:true},enabled?"AI matching enabled for this posting.":"Automatic AI matching is off for this posting.");
    if(result!==undefined){await resource.reload();changed();}
  }
  async function queue() {
    const result=await mutation.run("/api/ai/match","POST",{jobId},"Applications queued for AI review. Results appear as background reviews finish.");
    if(result!==undefined){await resource.reload();changed();}
  }
  return <details className="hub-card" aria-label="AI matching for this job">
    <summary>AI settings for this job{resource.data ? resource.data.enabled ? " · On" : " · AI matching is off — open to enable" : ""}{resource.error || resource.data?.error ? " · Needs attention" : ""}</summary>
    <p>Compare résumés and application answers with the same requirements from this job’s description. No scorecard setup needed.</p>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {resource.data && <>
      <label className="hub-checkbox"><input type="checkbox" checked={resource.data.enabled} disabled={mutation.busy || !resource.data.version} onChange={e=>void toggle(e.target.checked)}/> Automatically review applicants for this job</label>
      <p className="hub-muted">Enabling this reviews existing and new applicants, sending relevant résumé text and answers to OpenRouter / OpenAI. Results help your team compare evidence; they do not make hiring decisions or send rejections. API usage is billed to your OpenRouter account.</p>
      {resource.data.error && <p role="alert" className="hub-notice hub-error">{diagnosticError(resource.data.error)} {/^[a-z0-9_]{1,100}$/.test(resource.data.error) && <small>Code: {resource.data.error}</small>}</p>}
      {resource.data.enabled && <><p>{labels[resource.data.status] || (resource.data.status === "ready" ? "Job requirements are ready." : resource.data.status)}</p><button type="button" className="hub-button secondary" disabled={mutation.busy || resource.data.available === false} onClick={()=>void queue()}>Review existing applicants</button><p className="hub-muted">Then choose “Highest AI match first” above and apply filters. Refresh the list to see completed reviews.</p></>}
      {resource.data.diagnostics && <section className="hub-notice" aria-label="AI review progress"><h4>AI review progress</h4><p>Job requirements: {({ready:"Ready",pending:"Waiting",running:"Preparing",failed:"Failed",not_queued:"Not queued"} as Record<string,string>)[resource.data.diagnostics.criteria.status] || "Needs attention"} · {resource.data.diagnostics.criteria.attempts} attempts.</p>{resource.data.diagnostics.criteria.error && <p className="hub-error">{diagnosticError(resource.data.diagnostics.criteria.error)} <small>Code: {resource.data.diagnostics.criteria.error}</small></p>}{!!resource.data.diagnostics.errors?.length && <div><h4>Recent review errors</h4><ul>{resource.data.diagnostics.errors.map((error,index)=><li key={error.code || index}>{error.count} review{error.count === 1 ? "" : "s"}: {diagnosticError(error.code)}{error.code && <small> Code: {error.code}</small>}</li>)}</ul></div>}<p>{resource.data.diagnostics.counts.complete} completed · {resource.data.diagnostics.counts.running} processing · {resource.data.diagnostics.counts.pending} waiting · {resource.data.diagnostics.counts.failed} failed · {resource.data.diagnostics.counts.needsReview} need manual review · {resource.data.diagnostics.counts.notQueued} not queued</p>{resource.data.diagnostics.reasons.map(reason => <p key={reason}>{diagnosticReasons[reason] || "AI processing needs administrator attention. Refresh to check its status."}</p>)}<p>Hourly AI capacity: {resource.data.diagnostics.budget.remaining} of {resource.data.diagnostics.budget.limit} requests remaining.{resource.data.diagnostics.budget.resetsAt ? ` Resets ${new Date(resource.data.diagnostics.budget.resetsAt).toLocaleString()}.` : ""}</p>{resource.data.diagnostics.nextRetryAt && <p>Next eligible retry: {new Date(resource.data.diagnostics.nextRetryAt).toLocaleString()}.</p>}<p className="hub-muted">Status refreshes automatically while reviews are waiting. Viewing this status does not start reviews or spend AI credits.</p></section>}
      {!!resource.data.criteria?.length && <details><summary>Requirements used for every applicant</summary><ul>{resource.data.criteria.map(c=><li key={c}>{c}</li>)}</ul><p className="hub-muted">These come from the job description. Edit the job if its requirements need correction; older results must then be reviewed again.</p></details>}
    </>}
    <div className="hub-button-row"><button type="button" className="hub-button secondary" disabled={resource.loading || mutation.busy} onClick={()=>void resource.reload()}>Refresh AI settings</button></div>
    <Feedback error={mutation.error} success={mutation.success}/>
  </details>;
}
export function CandidateMatch({applicationId}:{applicationId:string}) {
  const resource=useHubResource<MatchDetail>("/api/ai/match?applicationId="+encodeURIComponent(applicationId));
  const reload=resource.reload;
  const pending=["pending","preparing","running"].includes(resource.data?.status || "")||!!resource.data?.progress?.nextRetryAt;
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>void reload(),15000);return()=>clearInterval(timer);},[pending,reload]);
  const match=resource.data;
  const criteria=match?.status === "ready" ? match.criteria || [] : [];
  const strengths=criteria.filter(criterion=>criterion.status === "evidence_found");
  const questions=criteria.filter(criterion=>criterion.status !== "evidence_found");
  return <section className="hub-card hub-match-overview" aria-label="AI job match">
    <div className="hub-section-heading compact"><div><h3>AI job match</h3><p>Evidence from the résumé and application answers.</p></div>{match && <MatchScore match={match}/>}</div>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void reload()}/>
    {match && <>
      {match.progress && !["ready","needs_review","disabled","setup_required"].includes(match.status) && <MatchQueueProgress progress={match.progress}/> }
      {match.error && !["ai_hourly_capacity","pdf_busy"].includes(match.error) && <p role="alert" className="hub-notice hub-error">{diagnosticError(match.error)}</p>}
      {match.status==="disabled" && <p>Enable AI matching for this job to compare applicants automatically.</p>}
      {match.status==="needs_review" && <p>The source material could not be assessed automatically. Open the résumé and application answers to check the missing information.</p>}
      {criteria.length>0 && <>
        <p className="hub-match-coverage"><strong>{strengths.length} of {criteria.length} requirements supported</strong>{questions.length>0 ? ` · ${questions.length} to clarify` : " · Supporting evidence found for every requirement"}</p>
        <div className="hub-match-summary-grid">
          <section aria-labelledby="match-strengths"><h4 id="match-strengths">Supported evidence</h4>{strengths.length ? <ul className="hub-evidence-list">{strengths.map(criterion=><EvidenceItem key={criterion.criterion} criterion={criterion}/>)}</ul> : <p>No supporting evidence was found in the submitted material.</p>}</section>
          <section aria-labelledby="match-questions"><h4 id="match-questions">What to clarify</h4>{questions.length ? <ul className="hub-evidence-list">{questions.map(criterion=><EvidenceItem key={criterion.criterion} criterion={criterion}/>)}</ul> : <p>Confirm the candidate’s experience and contribution in the interview.</p>}</section>
        </div>

      </>}
      {!!match.sourceWarnings?.length && <p className="hub-muted">Some source material could not be fully read. Check the original résumé before deciding.</p>}
      <p className="hub-muted hub-ai-decision-note">Evidence comparison only. Your team makes the hiring decision.</p>
    </>}
    <button type="button" className="hub-text-button" disabled={resource.loading} onClick={()=>void reload()}>Refresh AI review</button>
  </section>;
}

function MatchQueueProgress({progress}:{progress:MatchProgress}) {
 const next=progress.nextRetryAt?new Date(progress.nextRetryAt).toLocaleString():null;
 return <div className="hub-notice" aria-label="AI processing status">
  {progress.state==="running" ? <p role="status">Reading the résumé or waiting for the AI provider. Attempt {progress.attempts} of 5 is in progress.</p>
   : progress.state==="provider_paused" ? <p role="status">The AI provider has paused processing. {diagnosticError(progress.providerPauseReason||null)} Next automatic check after {next}.</p>
   : progress.state==="capacity_paused" ? <p role="status">Paused at the hourly processing limit ({progress.hourlyLimit} requests across all jobs). Reviews resume after {next}. An administrator can adjust capacity in Company → AI connection.</p>
   : progress.state==="retry_scheduled" ? <p role="status">A temporary problem interrupted this review. Attempt {Math.min(progress.attempts+1,5)} of 5 is scheduled after {next}. You do not need to retry it manually.</p>
   : progress.state==="retry_limit" ? <p role="status">Automatic retries stopped after {progress.attempts} attempts. An administrator must resolve the error below, then retry failed reviews for this job.</p>
   : progress.state==="preparing_requirements" ? <p role="status">Preparing this job’s requirements before applicant reviews can start.</p>
   : <p role="status">Queued for AI review.{progress.readyAhead!==null?` ${progress.readyAhead} eligible review${progress.readyAhead===1?"":"s"} ahead across all jobs.`:""} Up to three reviews run together.</p>}
  <details className="hub-setup-details"><summary>Processing details</summary><p className="hub-muted">{progress.capacityRemaining} of {progress.hourlyLimit} provider requests remain this hour. Status refreshes automatically; opening this page does not start or charge for a review.</p></details>
 </div>;
}

function EvidenceItem({criterion}:{criterion:NonNullable<MatchDetail["criteria"]>[number]}) {return <li><strong>{criterion.criterion}</strong><p>{readableMatchExplanation(criterion.explanation)}</p>{criterion.citations.length>0&&<details><summary>Source excerpts ({criterion.citations.length})</summary>{criterion.citations.map((citation,index)=><blockquote key={index}><strong>{citation.source==='resume'?'Résumé':'Application answer'}</strong><p>{readableMatchExplanation(citation.quote)}</p></blockquote>)}</details>}</li>;}
