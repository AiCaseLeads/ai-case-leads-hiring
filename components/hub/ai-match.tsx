"use client";
import { useEffect } from "react";
import { useHubMutation, useHubResource } from "./api";
import { Feedback, ResourceState } from "./shared";

export type MatchSummary = {status: string; score: number | null; updatedAt?: number | null};
type MatchDetail = MatchSummary & {model?: string; error?: string; sourceWarnings?: string[]; criteria?: {criterion: string; status: string; explanation: string; citations: {source: string; quote: string}[]}[]};
type MatchDiagnostics = {errors?:{code:string|null;count:number}[];counts:{pending:number;running:number;complete:number;failed:number;needsReview:number;notQueued:number;total:number};criteria:{status:string;error?:string|null;attempts:number;nextRetryAt?:number|null};budget:{limit:number;used:number;remaining:number;resetsAt:number};worker:{enabled:boolean|null;encryptionKeyConfigured:boolean;leaseUntil?:number|null};nextRetryAt?:number|null;reasons:string[]};
type MatchJob = {diagnostics?:MatchDiagnostics;enabled: boolean; jobId: string; version: number; available?: boolean; criteria: string[]; status: string; error?: string};
const labels: Record<string,string> = {disabled:"AI review off",setup_required:"Connect AI in Company setup",pending:"Waiting for AI review",preparing:"Preparing job requirements",running:"AI review in progress",needs_review:"Needs manual review",failed:"AI review needs attention",stale:"Job changed · review needed"};
const diagnosticReasons: Record<string,string> = {
  job_disabled:"AI matching is off for this job.",
  provider_not_configured:"Connect and enable OpenRouter in Company setup before reviews can run.",
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
  ai_not_configured:"OpenRouter is not configured or enabled in Company setup.",
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
      {resource.data.diagnostics && <section className="hub-notice" aria-label="AI review progress"><h4>AI review progress</h4><p>Job requirements: {({ready:"Ready",pending:"Waiting",running:"Preparing",failed:"Failed",not_queued:"Not queued"} as Record<string,string>)[resource.data.diagnostics.criteria.status] || "Needs attention"} · {resource.data.diagnostics.criteria.attempts} attempts.</p>{resource.data.diagnostics.criteria.error && <p className="hub-error">{diagnosticError(resource.data.diagnostics.criteria.error)} <small>Code: {resource.data.diagnostics.criteria.error}</small></p>}{!!resource.data.diagnostics.errors?.length && <div><h4>Recent review errors</h4><ul>{resource.data.diagnostics.errors.map((error,index)=><li key={error.code || index}>{error.count} review{error.count === 1 ? "" : "s"}: {diagnosticError(error.code)}{error.code && <small> Code: {error.code}</small>}</li>)}</ul></div>}<p>{resource.data.diagnostics.counts.complete} completed · {resource.data.diagnostics.counts.running} processing · {resource.data.diagnostics.counts.pending} waiting · {resource.data.diagnostics.counts.failed} failed · {resource.data.diagnostics.counts.needsReview} need manual review · {resource.data.diagnostics.counts.notQueued} not queued</p>{resource.data.diagnostics.reasons.map(reason => <p key={reason}>{diagnosticReasons[reason] || "AI processing needs administrator attention. Refresh to check its status."}</p>)}<p>Hourly AI capacity: {resource.data.diagnostics.budget.remaining} of {resource.data.diagnostics.budget.limit} requests remaining.{resource.data.diagnostics.budget.resetsAt ? ` Resets ${new Date(resource.data.diagnostics.budget.resetsAt).toLocaleString()}.` : ""}</p>{resource.data.diagnostics.nextRetryAt && <p>Next eligible retry: {new Date(resource.data.diagnostics.nextRetryAt).toLocaleString()}.</p>}<p className="hub-muted">Refresh AI settings to check progress. Viewing this status does not start reviews or spend AI credits.</p></section>}
      {!!resource.data.criteria?.length && <details><summary>Requirements used for every applicant</summary><ul>{resource.data.criteria.map(c=><li key={c}>{c}</li>)}</ul><p className="hub-muted">These come from the job description. Edit the job if its requirements need correction; older results must then be reviewed again.</p></details>}
    </>}
    <div className="hub-button-row"><button type="button" className="hub-button secondary" disabled={resource.loading || mutation.busy} onClick={()=>void resource.reload()}>Refresh AI settings</button></div>
    <Feedback error={mutation.error} success={mutation.success}/>
  </details>;
}
export function CandidateMatch({applicationId}:{applicationId:string}) {
  const resource=useHubResource<MatchDetail>("/api/ai/match?applicationId="+encodeURIComponent(applicationId));
  const reload=resource.reload;
  const pending=["pending","preparing","running"].includes(resource.data?.status || "");
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>void reload(),15000);return()=>clearInterval(timer);},[pending,reload]);
  const match=resource.data;
  const criteria=match?.status === "ready" ? match.criteria || [] : [];
  const strengths=criteria.filter(criterion=>criterion.status === "evidence_found");
  const questions=criteria.filter(criterion=>criterion.status !== "evidence_found");
  return <section className="hub-card hub-match-overview" aria-label="AI job match">
    <div className="hub-section-heading compact"><div><h3>AI job match</h3><p>Résumé and answers compared with this job’s requirements.</p></div>{match && <MatchScore match={match}/>}</div>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void reload()}/>
    {match && <>
      {match.error && <p role="alert">{diagnosticError(match.error)} {/^[a-z0-9_]{1,100}$/.test(match.error) && <small>Code: {match.error}</small>}</p>}
      {match.status==="disabled" && <p>Enable AI matching for this job to compare applicants automatically.</p>}
      {match.status==="needs_review" && <p>The source material could not be assessed automatically. Open the résumé and application answers to check the missing information.</p>}
      {criteria.length>0 && <>
        <p className="hub-match-coverage"><strong>{strengths.length} of {criteria.length} requirements supported</strong>{questions.length>0 ? ` · ${questions.length} to clarify` : " · Supporting evidence found for every requirement"}</p>
        <div className="hub-match-summary-grid">
          <section aria-labelledby="match-strengths"><h4 id="match-strengths">Relevant strengths</h4>{strengths.length ? <ul>{strengths.slice(0,3).map(criterion=><li key={criterion.criterion}><strong>{criterion.criterion}</strong><p>{criterion.explanation}</p></li>)}</ul> : <p>No supporting evidence was found in the submitted material.</p>}</section>
          <section aria-labelledby="match-questions"><h4 id="match-questions">What to clarify</h4>{questions.length ? <ul>{questions.slice(0,3).map(criterion=><li key={criterion.criterion}><strong>{criterion.criterion}</strong><p>{criterion.explanation}</p></li>)}</ul> : <p>Confirm the candidate’s experience and contribution in the interview.</p>}</section>
        </div>
        <details className="hub-match-source-evidence"><summary>View source evidence · {criteria.length} requirements</summary><div>{criteria.map((criterion,index)=><article className="hub-history-item" key={index}><strong>{criterion.criterion}</strong><p>{criterion.status==="evidence_found"?"Evidence found":criterion.status==="needs_verification"?"Needs clarification":"Evidence not found"} — {criterion.explanation}</p>{criterion.citations.map((citation,i)=><blockquote key={i}><p>{citation.quote}</p><small>Source: {citation.source}</small></blockquote>)}</article>)}</div></details>
      </>}
      {!!match.sourceWarnings?.length && <details className="hub-match-source-warnings"><summary>Source limitations · {match.sourceWarnings.length}</summary>{match.sourceWarnings.map(warning=><p className="hub-notice" key={warning}>{warning}</p>)}</details>}
      <p className="hub-muted">AI match measures evidence against the job description. Missing evidence is not proof of missing ability. Your team makes the hiring decision.</p>
      <details className="hub-match-review-details"><summary>Review details</summary><small>{match.model ? `Model: ${match.model}. ` : ""}{match.updatedAt ? `${match.status === "ready" ? "Reviewed" : "Updated"} ${new Date(match.updatedAt).toLocaleString()}.` : ""}</small></details>
    </>}
    <button type="button" className="hub-text-button" disabled={resource.loading} onClick={()=>void reload()}>Refresh AI review</button>
  </section>;
}
