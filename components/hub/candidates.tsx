"use client";
import {ShareApplicant} from "./share-applicant";
import {BulkRejection} from "./bulk-rejection";
import {activitySummary, communicationSummary} from "./activity-summary";
import { ApplicationAnswers, answerContactName } from "./application-answers";
import { JobActionMenu } from "./action-menu";
import { ApplicantNavigation, ResumePreview, resumeFile } from "./application-review-tools";
import { requestDraftNavigation } from "./draft-navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarClock, Download, ExternalLink, Search, StickyNote, Settings2, RefreshCw, Trash2, Users } from "lucide-react";
import {
  hubRequest,
  displayAnswer,
  displayDate,
  useHubMutation,
  useHubResource,
} from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import { ReusableScorecard, useScorecardDraft } from "./scorecards";
import { CandidateEvidence, useEvidenceDraft } from "./ai-review";
import { MatchScore, JobMatchSetup, CandidateMatch } from "./ai-match";
import { jobGroup, jobLocation } from "./job-organization";
import { downloadApplication } from "./export";
import { sortHubJobs } from "./job-order";
import {
  stages,
  stageLabel,
  type ApplicationDetail,
  type ApplicationList,
  type ApplicationSummary,
  type HubJob,
  type ReviewerGrade,
} from "./types";

function reviewQueue(params:URLSearchParams) {
  if(params.get("stage") || params.get("trash")==="true")params.delete("active");
  else if(!params.has("active"))params.set("active","true");
  return params;
}
function GradeSummary({ grade }: { grade?: ReviewerGrade }) {
  return grade?.reviewed && grade.averageScore !== null ? (
    <span><strong>{grade.averageScore.toFixed(2)} / 5</strong><span className="hub-secondary-line">{grade.reviewerCount} reviewer{grade.reviewerCount === 1 ? "" : "s"}</span></span>
  ) : <span className="hub-muted">Ungraded</span>;
}

function missingAnswer(value: unknown) {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}
function qualificationTone(value: string) {
  return value === "pass" ? "success" : value === "fail" ? "danger" : "neutral";
}
function qualificationLabel(value: string, screeningConfigured?: boolean) {
  return value === "pass" ? "Requirements met" : value === "fail" ? "Requirement not met" : screeningConfigured === false ? "No screening rules" : screeningConfigured === true ? "Check answers" : "No screening decision";
}
type InterviewReadiness = {sender:string|null;mailReady:boolean;mailIssue:string|null;companyGoogleReady:boolean;sharedCalendarReady:boolean;renewCalendarReady:boolean;hasActiveInterview:boolean;interviewers:{email:string;ready:boolean}[]};
function InterviewBookingChoice({applicationId,value,change,renew,ready}:{applicationId:string;value:string;change:(value:string)=>void;renew:boolean;ready:(value:boolean)=>void}) {
  const resource=useHubResource<InterviewReadiness>("/api/interview-readiness?applicationId="+encodeURIComponent(applicationId));
  const canSend=!!resource.data?.mailReady && !!resource.data.companyGoogleReady && (renew ? resource.data.hasActiveInterview && resource.data.renewCalendarReady : (value==="__shared__" ? resource.data.sharedCalendarReady : !!resource.data.interviewers.find(person=>person.email===value&&person.ready)));
  useEffect(()=>{ready(canSend);return()=>ready(false);},[canSend,ready]);
  return <div className="hub-interviewer-choice">
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {resource.data && <>
      {!resource.data.companyGoogleReady && <p className="hub-notice">Company Google connection needs attention. Ask the owner to reconnect it in Settings → Company → Files &amp; calendar.</p>}
      <Field label="Who will conduct this interview?" hint={renew?"A replacement link keeps the original organizer.":"Choose a connected calendar. The applicant picks an available time."}>
        <select required={!renew} value={value} onChange={event=>change(event.target.value)} disabled={renew||resource.loading}>
          <option value="">{renew?"Keep original interviewer":"Choose an interviewer"}</option>
          <option value="__shared__" disabled={!resource.data.sharedCalendarReady}>Shared company calendar{resource.data.sharedCalendarReady?"":" — setup needed"}</option>
          {resource.data.interviewers.map(person=><option key={person.email} value={person.email} disabled={!person.ready}>{person.email}{person.ready?"":" — setup needed"}</option>)}
        </select>
      </Field>
      {resource.data.mailReady ? <p className="hub-muted">Invitation from {resource.data.sender}. Replies go to that recruiter.</p> : <p className="hub-notice">{resource.data.mailIssue==="recruiter_reply_contact_required" ? "Choose a recruiter to handle candidate replies in this job’s hiring team before sending invitations." : `${resource.data.sender || "The recruiter"} needs to connect their recruiting email in Settings → My connections before invitations can be sent.`}</p>}
      {renew && !resource.data.hasActiveInterview && <p className="hub-notice">No active interview to replace. Turn off replacement mode and choose an interviewer.</p>}
      {renew && resource.data.companyGoogleReady && resource.data.hasActiveInterview && !resource.data.renewCalendarReady && <p className="hub-notice">The original interviewer needs to reconnect their calendar and save availability before sending a replacement link.</p>}
      {!renew && resource.data.companyGoogleReady && !resource.data.sharedCalendarReady && !resource.data.interviewers.some(person=>person.ready) && <p className="hub-notice">Connect an interview calendar and save availability in Settings → My connections.</p>}
    </>}
  </div>;
}
export function CandidateTable({
  items,
  select,
  selected,
  toggle,
  togglePage,
  shortlist,
  unshortlist,
  interview,
  busy = false,
  showRole = true,
  screeningConfigured, sort, onSort, qualification, assignee, onColumnFilter,
}: {
  items: ApplicationSummary[];
  select: (id: string) => void;
  selected?: string[];
  toggle?: (id: string) => void;
  togglePage?: () => void;
  shortlist?: (item: ApplicationSummary) => void;
  unshortlist?: (item: ApplicationSummary) => void;
  interview?: (item: ApplicationSummary) => void;
  busy?: boolean;
  showRole?: boolean;
  screeningConfigured?: boolean;
  sort?: string; onSort?: (value:string)=>void;
  qualification?: string; assignee?: string; onColumnFilter?: (key:string,value:string)=>void;
}) {
  const [cardLayout,setCardLayout]=useState(false);
  useEffect(()=>{const query=window.matchMedia("(max-width:960px)");const sync=()=>setCardLayout(query.matches);sync();query.addEventListener("change",sync);return()=>query.removeEventListener("change",sync);},[]);
  return (
    <div className="hub-table-wrap">
      <table className="hub-table hub-applications-table" role="table" aria-label="Applications">
        <thead role="rowgroup">
          <tr role="row">
            {toggle && (
              <th scope="col" role="columnheader">
                {togglePage && !cardLayout ? <input type="checkbox" aria-label="Select all applicants on this page" checked={items.length > 0 && items.every(item => selected?.includes(item.id))} ref={input => { if (input) input.indeterminate = items.some(item => selected?.includes(item.id)) && !items.every(item => selected?.includes(item.id)); }} onChange={togglePage} /> : <span className="sr-only">Select candidate</span>}
              </th>
            )}
            <th scope="col" role="columnheader">Candidate</th>
            {showRole && <th scope="col" role="columnheader">Role</th>}
            <th scope="col" role="columnheader">Stage</th>
            <th scope="col" role="columnheader" aria-sort={sort==="screening_asc"?"ascending":sort==="screening_desc"?"descending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="screening_asc"?"screening_desc":"screening_asc")}>Screening <span aria-hidden="true">{sort==="screening_asc"?"↓":sort==="screening_desc"?"↑":"↕"}</span></button>:"Screening"}{onColumnFilter && !cardLayout&&<JobActionMenu label="Filter Screening" triggerLabel={qualification?"Filtered":"Filter"}><label className="hub-column-filter">Screening result<select aria-label="Filter screening result" value={qualification||""} onChange={event=>onColumnFilter("qualification",event.target.value)}><option value="">All results</option><option value="pass">Requirements met</option><option value="review">No automatic decision</option><option value="fail">Requirement not met</option></select></label></JobActionMenu>}</th>
            <th scope="col" role="columnheader" aria-sort={sort==="ai_match_desc"?"descending":sort==="ai_match_asc"?"ascending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="ai_match_desc"?"ai_match_asc":"ai_match_desc")}>AI job match <span aria-hidden="true">{sort==="ai_match_desc"?"↓":sort==="ai_match_asc"?"↑":"↕"}</span></button>:"AI job match"}</th>
            <th scope="col" role="columnheader" className="hub-optional-owner" aria-sort={sort==="owner_asc"?"ascending":sort==="owner_desc"?"descending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="owner_asc"?"owner_desc":"owner_asc")}>Owner <span aria-hidden="true">{sort==="owner_asc"?"↓":sort==="owner_desc"?"↑":"↕"}</span></button>:"Owner"}{onColumnFilter && !cardLayout&&<JobActionMenu label="Filter Owner" triggerLabel={assignee?"Filtered":"Filter"}><form className="hub-column-filter" key={assignee||"any"} onSubmit={event=>{event.preventDefault();onColumnFilter("assignee",String(new FormData(event.currentTarget).get("owner")||"").trim());}}><label>Recruiter email<input aria-label="Filter owner email" name="owner" type="email" defaultValue={assignee||""}/></label><button type="submit">Apply owner filter</button><button type="button" onClick={()=>onColumnFilter("assignee","")}>All owners</button></form></JobActionMenu>}</th>
            <th scope="col" role="columnheader" className="hub-optional-applied" aria-sort={sort==="newest"?"descending":sort==="oldest"?"ascending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="newest"?"oldest":"newest")}>Applied <span aria-hidden="true">{sort==="newest"?"↓":sort==="oldest"?"↑":"↕"}</span></button>:"Applied"}</th>
            {(shortlist || unshortlist || interview) && <th scope="col" role="columnheader">Next step</th>}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {items.map((item) => (
            <tr key={item.id} role="row">
              {toggle && (
                <td role="cell" data-label="Select" className="hub-candidate-select">
                  <label className="hub-select-target"><span className="sr-only">Select {item.name}</span><input
                    type="checkbox"
                    aria-label={"Select " + item.name}
                    checked={selected?.includes(item.id) || false}
                    onChange={() => toggle(item.id)}
                  /></label>
                </td>
              )}
              <td role="cell" data-label="Candidate" className="hub-candidate-identity">
                <button
                  className="hub-text-button hub-candidate-name"
                  onClick={() => select(item.id)}
                >
                  {item.name || "Unnamed applicant"}
                </button>
                <span className="hub-secondary-line">{item.email}</span>
                <span title={item.viewedAt?`Viewed by you ${displayDate(item.viewedAt)}`:"No recorded view by you yet. This does not mean a new application."}><Badge tone={item.viewedAt?"neutral":"success"}>{item.viewedAt?"Viewed":"New to you"}</Badge></span>
                {item.duplicateEmail && <Badge tone="warning">Shared email · {item.duplicateApplicationCount || 2} applications</Badge>}
              </td>
              {showRole && <td role="cell" data-label="Role">{item.jobTitle}</td>}
              <td role="cell" data-label="Stage">
                <Badge>{item.trashed?"In Trash":stageLabel(item.stage)}</Badge>
              </td>
              <td role="cell" data-label="Screening">
                <span title={item.qualification === "review" ? screeningConfigured === false ? "This job has no enabled screening rules. The AI match is shown separately." : "An answer needed by the screening rules is missing or could not be evaluated. Check the application answers. The AI match is shown separately." : undefined}><Badge tone={qualificationTone(item.qualification)}>{qualificationLabel(item.qualification, screeningConfigured)}</Badge></span>
              </td>
              <td role="cell" data-label="AI job match"><MatchScore match={item.aiMatch} /></td>
              <td role="cell" data-label="Owner" className="hub-optional-owner">{item.assignee || "Unassigned"}</td>
              <td role="cell" data-label="Applied" className="hub-nowrap hub-optional-applied">{displayDate(item.createdAt)}</td>
              {(shortlist || unshortlist || interview) && <td role="cell" data-label="Next step"><div className="hub-candidate-row-actions">
                {shortlist && !item.trashed && item.stage === "Application Review" && <button type="button" className="hub-button secondary" disabled={busy} onClick={() => shortlist(item)}>Shortlist<span className="sr-only"> {item.name}</span></button>}
                {unshortlist && !item.trashed && item.stage === "Screening" && <button type="button" className="hub-button secondary" disabled={busy} onClick={() => unshortlist(item)}>Remove from shortlist<span className="sr-only"> {item.name}</span></button>}
                {interview && !item.trashed && !["Rejected", "Withdrawn", "Hired"].includes(item.stage) && <button type="button" className="hub-text-button" disabled={busy} onClick={() => interview(item)}>Request interview<span className="sr-only"> with {item.name}</span></button>}
              </div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type CandidatesProps = {
  jobs: HubJob[]; refresh: number; changed: () => void; reviewerEmail: string;
  initialStage?: string; initialJobId?: string; initialFilter?: string; initialPage?: number;
  onSelect?: (id: string, action?: "interview", filter?: string) => void; onFilterChange?: (filter: string, page: number) => void;
};

export function Candidates(props: CandidatesProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [downloadBusy, setDownloadBusy] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  async function downloadJob(job: HubJob, format: "csv" | "zip") {
    setDownloadBusy(job.id); setDownloadError(""); setDownloadNotice("");
    try {
      const url = "/api/hub/applications-export?" + new URLSearchParams({jobId:job.id,format});
      const response = await fetch(url + "&check=1", {credentials:"same-origin",cache:"no-store"});
      const result = await response.json().catch(() => null) as {error?: {message?: string}} | null;
      if (!response.ok) throw new Error(result?.error?.message || "Download could not be prepared. Open this job and narrow the filters, then try again.");
      const link = document.createElement("a"); link.href=url; link.download=`applications-${job.slug}.${format}`; document.body.appendChild(link); link.click(); link.remove();
      setDownloadNotice(`${job.title}: download started for all applications. Check your browser’s downloads for completion.`);
    } catch (error) {setDownloadError(error instanceof Error ? error.message : "Download failed.");}
    finally {setDownloadBusy("");}
  }
  const counts = useHubResource<{items: {jobId:string;total:number;needsReview:number;aiReady:number}[]}>("/api/hub/application-counts", props.refresh);
  if (props.initialJobId && props.jobs.some(job => job.id === props.initialJobId)) return <JobCandidates {...props} />;
  const jobs = sortHubJobs(props.jobs).filter(job => (status === "archived" ? job.lifecycle?.state === "archived" : status === "deleted" ? job.lifecycle?.state === "deleted" : (!job.lifecycle || job.lifecycle.state === "active") && (status === "all" || job.status === status)) && `${job.title} ${job.location || ""} ${jobGroup(job)} ${job.hiringRound || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-labelledby="application-jobs-title">
    <div className="hub-section-heading compact"><div><p className="hub-kicker">APPLICANTS</p><h2 id="application-jobs-title">Choose a job</h2><p>Keep each hiring process together. Open a job to compare, shortlist, and interview its applicants.</p></div></div>
    <div className="hub-applicant-filters"><Field label="Find a job"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Job title or location" /></Field><Field label="Job status"><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All current jobs</option><option value="open">Open jobs</option><option value="closed">Paused jobs</option><option value="draft">Draft jobs</option><option value="archived">Archived jobs</option><option value="deleted">Jobs in Trash</option></select></Field></div>
    <Feedback error={downloadError} success={downloadNotice}/>
    <div className="hub-application-job-list">{jobs.map(job => {
      const count = counts.data?.items.find(item => item.jobId === job.id);
      const openJob = () => {const params=new URLSearchParams({jobId:job.id});if(props.initialStage)params.set("stage",props.initialStage);props.onFilterChange?.(params.toString(),1);};
      return <article className="hub-application-job-row" key={job.id}>
        <div><h3><button type="button" className="hub-text-button hub-job-title-link" onClick={openJob}>{job.title}</button></h3><p className="hub-muted">{job.location || jobLocation(job)} · {job.lifecycle?.state === "archived" ? "Archived" : job.lifecycle?.state === "deleted" ? "In Trash" : job.status === "open" ? "Open" : job.status === "closed" ? "Paused" : "Draft"}</p></div>
        <div className="hub-job-applicant-count"><strong>{counts.data ? count?.total || 0 : counts.loading ? "…" : "—"}</strong><span>applicants</span></div>
        <JobActionMenu label={`Manage applicants for ${job.title}`} triggerLabel="Manage"><button type="button" onClick={openJob}><Users size={16} aria-hidden="true"/>View applications</button><button type="button" disabled={!!downloadBusy} onClick={()=>void downloadJob(job,"zip")}><Download size={16} aria-hidden="true"/>{downloadBusy===job.id?"Preparing ZIP…":"Download all applications ZIP"}</button></JobActionMenu>
      </article>;
    })}</div>
    {!jobs.length && <EmptyState title="No jobs found"><p>Try another search or create a posting from Jobs.</p></EmptyState>}
  </section>;
}

function JobCandidates({
  jobs,
  refresh,
  changed,
  initialStage = "",
  initialJobId = "",
  initialFilter,
  initialPage = 1,
  onSelect,
  onFilterChange,
}: {
  jobs: HubJob[];
  refresh: number;
  changed: () => void;
  reviewerEmail: string;
  initialStage?: string;
  initialJobId?: string;
  initialFilter?: string;
  initialPage?: number;
  onSelect?: (id: string, action?: "interview", filter?: string) => void;
  onFilterChange?: (filter: string, page: number) => void;
}) {
  const defaultSort = "screening_newest";
  const initial = new URLSearchParams(initialFilter);
  if (!initial.has("sort")) initial.set("sort", defaultSort);
  if (initialStage) initial.set("stage", initialStage);
  if (initialJobId) initial.set("jobId", initialJobId);
  else {initial.delete("jobId"); initial.delete("grade"); initial.delete("sort");}
  reviewQueue(initial);
  const [q, setQ] = useState(initial.get("q") || ""),
    [jobId] = useState(initialJobId),
    [stage, setStage] = useState(initial.get("stage") || ""),
    [assignee, setAssignee] = useState(initial.get("assignee") || ""),
    [qualification, setQualification] = useState(initial.get("qualification") || ""),
    [grade, setGrade] = useState(initial.get("grade") || ""),
    [sort, setSort] = useState(initial.get("sort") || defaultSort),
    [appliedFrom, setAppliedFrom] = useState(initial.get("appliedFrom") || ""),
    [appliedTo, setAppliedTo] = useState(initial.get("appliedTo") || ""),
    [timeZone, setTimeZone] = useState(initial.get("timeZone") || "UTC"),
    [duplicate, setDuplicate] = useState(initial.get("duplicate") === "true"),
    [page, setPage] = useState(initialPage),
    [filter, setFilter] = useState(initial.toString()),
    [selected, setSelected] = useState<string[]>([]),
    [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (!initial.get("timeZone")) queueMicrotask(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
    // Resolve browser time zone after hydration; server and first browser render use the same fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [detailAction, setDetailAction] = useState<"note" | "interview">("note");
  const [detailSection,setDetailSection] = useState<"application"|"review"|"activity">("application");
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportScope, setExportScope] = useState("filtered");
  const [allMatching, setAllMatching] = useState(false);
  const selectedJob = jobs.find(job => job.id === jobId);
  const isTopTen = new URLSearchParams(filter).get("top") === "10";
  const inTrash = new URLSearchParams(filter).get("trash") === "true";
  const [bulkAction, setBulkAction] = useState("stage"),
    [bulkStage, setBulkStage] = useState("Screening"),
    [bulkAssignee, setBulkAssignee] = useState(""),
    [reason, setReason] = useState(""),
    [approve, setApprove] = useState(false);
  const path = "/api/hub/applications?" + filter + "&page=" + page;
  const resource = useHubResource<ApplicationList & { pageSize?: number }>(
      path,
      refresh,
    ),
    mutation = useHubMutation();
  const waitingForAi = resource.data?.items.some(item => item.aiMatch?.retryPending || ["pending", "preparing", "running"].includes(item.aiMatch?.status || ""));
  const reloadApplications = resource.reload;
  useEffect(() => {
    if (!waitingForAi) return;
    const timer = setInterval(() => void reloadApplications(), 15000);
    return () => clearInterval(timer);
  }, [waitingForAi, reloadApplications]);
  const visibleRevisions = resource.data?.items.map(item => `${item.id}:${item.revision}`).join("|");
  useEffect(() => {
    // A previous selection or rejection approval must not carry over to changed records.
    queueMicrotask(() => {setSelected([]); setApprove(false); setExportScope(current => current === "selected" ? "filtered" : current);});
  }, [refresh, visibleRevisions]);
  function draftQuery() {
    const search = new URLSearchParams();
    if (inTrash) search.set("trash", "true");
    for (const [key, value] of Object.entries({q, jobId, stage, assignee, qualification, grade, sort, appliedFrom, appliedTo})) {
      if (value) search.set(key, value);
    }
    if (appliedFrom || appliedTo) search.set("timeZone", timeZone);
    if (duplicate) search.set("duplicate", "true");
    if (isTopTen && sort === "ai_match_desc") search.set("top", "10");
    if(!stage&&!inTrash)search.set("active",new URLSearchParams(filter).get("active")||"true");
    return search;
  }
  const draft = draftQuery();
  const applied = new URLSearchParams(filter);
  const filtersDirty = Array.from(new Set([...draft.keys(), ...applied.keys()])).some(key => draft.get(key) !== applied.get(key));
  const invalidDates = !!appliedFrom && !!appliedTo && appliedFrom > appliedTo;
  function syncFields(params: URLSearchParams) {
    setQ(params.get("q") || ""); setStage(params.get("stage") || ""); setAssignee(params.get("assignee") || "");
    setQualification(params.get("qualification") || ""); setGrade(params.get("grade") || ""); setSort(params.get("sort") || defaultSort); setDuplicate(params.get("duplicate") === "true");
    setAppliedFrom(params.get("appliedFrom") || ""); setAppliedTo(params.get("appliedTo") || "");
    setTimeZone(params.get("timeZone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }
  const incomingFilter = initial.toString();
  const previousLocation = useRef({filter:incomingFilter,page:initialPage});
  useEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = {filter:incomingFilter,page:initialPage};
    if (previous.filter === incomingFilter && previous.page === initialPage) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPage(initialPage);
      if (previous.filter !== incomingFilter) {
        syncFields(new URLSearchParams(incomingFilter));
        setFilter(incomingFilter); setSelected([]); setAllMatching(false); setExportScope("filtered"); setApprove(false);
      }
    });
    return () => {cancelled = true;};
    // Location changes also cover browser Back/Forward without resetting all-matching selection on pagination.
  }, [incomingFilter, initialPage]);
  function filterSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalidDates) return;
    applyView(draft.toString());
  }
  function applyView(value: string) {
    const params = reviewQueue(new URLSearchParams(value));
    if (!params.has("sort")) params.set("sort", defaultSort);
    syncFields(params);
    const next = params.toString();
    onFilterChange?.(next, 1); setFilter(next); setPage(1); setSelected([]); setAllMatching(false); setExportScope("filtered"); setApprove(false); setExportMessage(""); setExportError("");
  }
  async function exportApplications(format: "csv" | "zip") {
    if (filtersDirty || invalidDates || resource.loading || resource.error) return;
    setExporting(true); setExportError(""); setExportMessage("");
    try {
      const params = new URLSearchParams(exportScope === "all" ? { jobId } : filter);
      params.set("jobId", jobId);
      if(inTrash)params.set("trash","true");
      params.delete("page");
      params.set("format", format);
      if (exportScope === "selected") params.set("ids", selected.join(","));
      const downloadUrl = "/api/hub/applications-export?" + params;
      const response = await fetch(downloadUrl + "&check=1", {credentials:"same-origin",cache:"no-store"});
      if (!response.ok) {
        const error = await response.json().catch(() => null) as {error?:{message?:string}} | null;
        throw new Error(error?.error?.message || `The download could not be prepared (status ${response.status}). Try a smaller selection or refresh and try again.`);
      }
      const link = document.createElement("a");
      link.href = downloadUrl; link.download = `applications-${selectedJob?.slug || jobId}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      setExportMessage(format === "csv" ? "Spreadsheet download started. Check your browser’s downloads for completion." : "Application files download started. Check your browser’s downloads for completion and the included PDF export report for unavailable files.");
    } catch (error) {setExportError(error instanceof Error ? error.message : "Download failed.");}
    finally {setExporting(false);}
  }
  async function applyBulk(e: React.FormEvent) {
    e.preventDefault();
    if (
      allMatching || filtersDirty || selected.length === 0 ||
      selected.length > 100 ||
      (bulkAction === "reject" && !approve)
    )
      return;
    const result = await mutation.run(
      "/api/hub/bulk",
      "POST",
      {
        ids: selected,
        expectedRevisions: Object.fromEntries((resource.data?.items || []).filter((item) => selected.includes(item.id)).map((item) => [item.id, item.revision])),
        action: bulkAction,
        ...(bulkAction === "stage"
          ? { stage: bulkStage }
          : bulkAction === "assign"
            ? { assignee: bulkAssignee.trim() || null }
            : { reason }),
      },
      "Bulk action saved. Candidate records have been updated.",
    );
    if (result !== undefined) {
      setSelected([]);
      setApprove(false);
      changed();
      void resource.reload();
    }
  }
  async function shortlist(item: ApplicationSummary) {
    if (item.stage !== "Application Review") return;
    const result = await mutation.run("/api/hub/applications/" + encodeURIComponent(item.id) + "/action", "POST", {action:"stage", stage:"Screening", expectedRevision:item.revision}, `${item.name} added to the shortlist.`);
    if (result !== undefined) {changed(); await resource.reload();}
  }
  async function unshortlist(item:ApplicationSummary){
    if(item.stage!=="Screening"||mutation.busy)return;
    const result=await mutation.run(`/api/hub/applications/${encodeURIComponent(item.id)}/action`,"POST",{action:"stage",stage:"Application Review",expectedRevision:item.revision},`${item.name} removed from the shortlist. No email sent.`);
    if(result!==undefined){changed();await resource.reload();}
  }
  async function unshortlistSelected(){
    if(allMatching||filtersDirty||mutation.busy)return;
    const records=(resource.data?.items||[]).filter(item=>selected.includes(item.id));
    if(!records.length||records.length!==selected.length||records.length>100||records.some(item=>item.stage!=="Screening"))return;
    const result=await mutation.run("/api/hub/bulk","POST",{ids:selected,expectedRevisions:Object.fromEntries(records.map(item=>[item.id,item.revision])),action:"stage",stage:"Application Review"},`${records.length} applicants removed from the shortlist. No emails sent.`);
    if(result!==undefined){setSelected([]);changed();await resource.reload();}
  }
  async function shortlistSelected() {
    if (allMatching || filtersDirty) return;
    const records=(resource.data?.items || []).filter(item=>selected.includes(item.id));
    if (!records.length || records.length!==selected.length || records.length>100 || records.some(item=>!["Application Review","Screening"].includes(item.stage))) return;
    const result=await mutation.run("/api/hub/bulk","POST",{ids:selected,expectedRevisions:Object.fromEntries(records.map(item=>[item.id,item.revision])),action:"stage",stage:"Screening"},`${records.length} applicants added to the shortlist.`);
    if (result!==undefined) {setSelected([]);changed();await resource.reload();}
  }
  if (detailId)
    return (
      <CandidateDetail
        key={detailId}
        id={detailId}
        back={() => {setDetailId(null); setDetailAction("note");setDetailSection("application");}}
        changed={changed}
        initialAction={detailAction}
        initialSection={detailSection}
        navigationFilter={filter}
        navigationJobs={jobs}
        onDecisionNotice={setExportMessage}
        openApplicant={(id,_filter,section)=>{setDetailSection(section || "application");setDetailId(id);}}
      />
    );
  return (
    <section className="hub-candidate-browser" aria-labelledby="candidates-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">RECRUITER WORKSPACE</p>
          <button className="hub-text-button" type="button" onClick={() => onFilterChange?.("", 1)}><ArrowLeft size={16} /> All jobs</button>
          <h2 id="candidates-title">{selectedJob?.title || "Job applications"}</h2>
          <p>
            {selectedJob?.location || (selectedJob ? jobLocation(selectedJob) : "")} · Applications for this posting
          </p>
        </div>
        <div className="hub-button-row"><span className="hub-count">
          {resource.data ? resource.data.total + " applications" : ""}
        </span><button type="button" className="hub-button secondary" disabled={resource.loading} onClick={() => void resource.reload()}>Refresh applications</button></div>
      </div>
      <div className="hub-button-row hub-application-view-tabs"><button className="hub-pipeline-tab" type="button" aria-pressed={!inTrash} onClick={()=>applyView(new URLSearchParams({jobId}).toString())}>Applications</button><button className="hub-pipeline-tab" type="button" aria-pressed={inTrash} onClick={()=>applyView(new URLSearchParams({jobId,trash:"true"}).toString())}>Trash</button></div>
      {inTrash && <p className="hub-muted">Deleted applications stay here with their original files and history. Open an application to restore it. Cancelled emails and booking links are not sent again.</p>}
      {!inTrash && <div className="hub-pipeline-tabs" role="group" aria-label="Hiring stages">{["active", "", "Application Review", "Screening", "Interview", "Offer", "Hired", "Rejected"].map(value=><button key={value||"all"} className={"hub-pipeline-tab"+((value==="active"?!stage&&new URLSearchParams(filter).get("active")==="true":stage===value&&(value!==""||new URLSearchParams(filter).get("active")==="false"))?" active":"")} type="button" aria-pressed={value==="active"?!stage&&new URLSearchParams(filter).get("active")==="true":stage===value&&(value!==""||new URLSearchParams(filter).get("active")==="false")} onClick={()=>{const params=new URLSearchParams(filter);if(value&&value!=="active"){params.set("stage",value);params.delete("active");}else{params.delete("stage");params.set("active",value==="active"?"true":"false");}applyView(params.toString());}}>{value==="active"?"Active":value?stageLabel(value):"All"}</button>)}</div>}
      <div className="hub-applicant-toolbar">
      <form className="hub-applicant-filter-form" onSubmit={filterSubmit}>
        <div className="hub-applicant-filters">
          <Field label="Search"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Name or email" type="search" /></Field>
          <Field label="Screening"><select value={qualification} onChange={e=>setQualification(e.target.value)}><option value="">All screening results</option><option value="pass">Requirements met</option><option value="review">No automatic decision</option><option value="fail">Requirement not met</option></select></Field>
          <button className="hub-button" type="submit" disabled={invalidDates}><Search size={16} /> Apply filters</button>
        </div>

        {invalidDates && <p role="alert">The end date must be on or after the start date.</p>}
        {filtersDirty && <p className="hub-notice" role="status">Your filters have changed. Click Apply filters to update the results and downloads.</p>}
        <details className="hub-advanced-filters"><summary>More filters{[grade,assignee,duplicate,appliedFrom,appliedTo].filter(Boolean).length ? ` · ${[grade,assignee,duplicate,appliedFrom,appliedTo].filter(Boolean).length} selected` : ""}</summary>
          <div className="hub-filter-grid">
          {!inTrash && <Field label="Stage"><select value={stage} onChange={e=>setStage(e.target.value)}><option value="">All stages</option>{stages.map(value=><option key={value} value={value}>{stageLabel(value)}</option>)}</select></Field>}
          {!inTrash && <Field label="Order"><select value={sort} onChange={e=>setSort(e.target.value)}><option value="screening_newest">Requirements met, then newest</option><option value="newest">Newest applications</option><option value="oldest">Oldest applications</option><option value="owner_asc">Owner A–Z</option><option value="owner_desc">Owner Z–A</option><option value="screening_asc">Requirements met first</option><option value="screening_desc">Unmet requirements first</option><option value="ai_match_asc">Lowest AI match first</option><option value="ai_match_desc">Highest AI match first</option><option value="grade_desc">Highest reviewer grade first</option></select></Field>}
          <Field label="Applied from"><input type="date" value={appliedFrom} max={appliedTo || undefined} onChange={e=>setAppliedFrom(e.target.value)}/></Field>
          <Field label="Applied through"><input type="date" value={appliedTo} min={appliedFrom || undefined} onChange={e=>setAppliedTo(e.target.value)}/></Field>

            <Field label="Reviewer grades" hint="Optional grades recorded by your team."><select value={grade} onChange={e=>setGrade(e.target.value)}><option value="">Graded and ungraded</option><option value="reviewed">Graded applications</option><option value="ungraded">Ungraded applications</option></select></Field>
            <Field label="Assigned to"><input value={assignee} onChange={e=>setAssignee(e.target.value)} type="email" placeholder="Recruiter email" /></Field>
            <label className="hub-checkbox"><input type="checkbox" checked={duplicate} onChange={e=>setDuplicate(e.target.checked)} /> Shared-email applications</label>
          </div><p className="hub-muted hub-filter-hint">Dates use {timeZone}.</p><button className="hub-button secondary" type="submit" disabled={invalidDates}>Apply more filters</button>
        </details>
      </form>
      <div className="hub-applicant-toolbar-actions">
        {!inTrash && <button className="hub-button secondary" type="button" onClick={() => applyView((() => {const params=new URLSearchParams(filter);params.set("sort","ai_match_desc");params.set("top","10");return params.toString();})())}>Top 10 AI matches</button>}
        {isTopTen && <button className="hub-text-button" type="button" onClick={() => applyView((() => {const params=new URLSearchParams(filter);params.delete("top");return params.toString();})())}>Show all applicants</button>}
        <button className="hub-text-button" type="button" onClick={()=>applyView(new URLSearchParams({jobId,...(inTrash?{trash:"true"}:{})}).toString())}>Clear filters</button>
        <details className="hub-download-menu hub-application-downloads"><summary><Download size={16} /> Download applications</summary>
          <div className="hub-download-menu-body">
            <div className="hub-button-row"><button className="hub-text-button" type="button" disabled={filtersDirty || resource.loading || !resource.data?.items.length} onClick={() => {setAllMatching(false);setSelected(resource.data?.items.map(item=>item.id)||[]);setExportScope("selected");}}>Select this page ({resource.data?.items.length||0})</button><button className="hub-text-button" type="button" disabled={filtersDirty || resource.loading || !resource.data?.total} onClick={() => {setSelected([]);setAllMatching(true);setExportScope("filtered");}}>Select all matching for download ({resource.data?.total||0})</button>{(selected.length>0 || allMatching) && <button className="hub-text-button" type="button" onClick={() => {setSelected([]);setAllMatching(false);setExportScope("filtered");}}>Clear selection ({allMatching ? resource.data?.total || 0 : selected.length})</button>}</div>
            <div className="hub-button-row hub-download-actions"><Field label="Download scope"><select value={exportScope} onChange={event=>{setExportScope(event.target.value);setAllMatching(false);}}><option value="filtered">All matching results ({resource.data?.total || 0}){isTopTen?" · Top 10":" · every page"}</option><option value="all">{inTrash?"All applications in Trash":"All applicants for this job"}</option><option value="selected">Selected applicants ({selected.length})</option></select></Field><button className="hub-button" type="button" disabled={exporting || resource.loading || !!resource.error || filtersDirty || invalidDates || (exportScope==="filtered"&&!resource.data?.total) || (exportScope==="selected"&&!selected.length)} onClick={()=>void exportApplications("zip")}><Download size={16}/> Download applications (ZIP)</button></div>
            <p className="hub-muted">{exportScope==="selected"?`${selected.length} selected applicants`:exportScope==="all"?(inTrash?"Every application in Trash for this job":"Every applicant for this job, across all pages and stages"):`${resource.data?.total||0} matching applicants across all pages`} will be downloaded. The ZIP includes a readable PDF for each application and the original uploaded files.</p>
            <details><summary>Download limits</summary><p>Up to 10,000 applications and 3 GB of attachments per download. Narrow the filters for larger archives. Bulk record changes apply to selected applicants on this page.</p></details>
            {exporting && <p role="status">Preparing your download…</p>}
            <Feedback error={exportError} success={exportMessage}/>
          </div>
        </details>
      </div>
      </div>
      {!inTrash && selectedJob && <BulkRejection filter={filter} selectedIds={allMatching?[]:selected} jobTitle={selectedJob.title} disabled={filtersDirty || resource.loading || !!resource.error || !resource.data?.total} changed={()=>{setSelected([]);setAllMatching(false);void resource.reload();changed();}}/>}
      {allMatching && <p className="hub-selection-banner" role="status">All {resource.data?.total || 0} matching applicants across every page are selected for download. To change applicant stages, clear this selection and select applicants on a single page.</p>}
      {isTopTen && <p className="hub-muted">Top 10 includes active applicants with a completed AI match in this filtered view.</p>}
      {selectedJob && !selectedJob.rules?.some(rule=>rule.enabled) && <p className="hub-muted hub-screening-help">No screening rules are enabled for this job. AI matches still compare the résumé and answers with the job description.</p>}
      <Feedback error={mutation.error} success={mutation.success}/>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {!resource.loading && resource.data && (
        <>
          {resource.data.items.length ? (
            <CandidateTable
              items={resource.data.items}
              showRole={false}
              qualification={new URLSearchParams(filter).get("qualification")||""}
              assignee={new URLSearchParams(filter).get("assignee")||""}
              onColumnFilter={(key,value)=>{const params=new URLSearchParams(filter);if(value)params.set(key,value);else params.delete(key);applyView(params.toString());}}
              sort={new URLSearchParams(filter).get("sort")||defaultSort}
              onSort={value=>{const params=new URLSearchParams(filter);params.set("sort",value);params.delete("top");applyView(params.toString());}}
              screeningConfigured={selectedJob?.rules?.some(rule=>rule.enabled) ?? false}
              busy={mutation.busy}
              shortlist={item=>void shortlist(item)}
              unshortlist={item=>void unshortlist(item)}
              interview={item=>{if(onSelect)onSelect(item.id,"interview",filter);else{setDetailAction("interview");setDetailId(item.id);}}}
              select={id=>onSelect?onSelect(id,undefined,filter):setDetailId(id)}
              selected={allMatching ? resource.data.items.map(item=>item.id) : selected}
              togglePage={() => {const ids = resource.data?.items.map(item => item.id) || []; setSelected(allMatching || ids.every(id => selected.includes(id)) ? [] : ids); setAllMatching(false); setExportScope("selected");}}
              toggle={(id) => {
                if (allMatching) {setAllMatching(false);setSelected((resource.data?.items || []).filter(item=>item.id!==id).map(item=>item.id));setExportScope("selected");return;}
                setExportScope("selected");
                setSelected((current) =>
                  current.includes(id)
                    ? current.filter((value) => value !== id)
                    : current.length < 100
                      ? [...current, id]
                      : current,
                );
              }}
            />
          ) : (
            <EmptyState title={isTopTen ? "No completed AI matches yet" : "No applications in this view"}>
              <p>{isTopTen ? "Enable AI matching for this job and wait for reviews to finish. Only active applicants with current, completed scores appear in the Top 10." : "New accepted applications appear here. Try another filter if records already exist."}</p>
            </EmptyState>
          )}
          {!isTopTen && <div className="hub-pagination">
            <button
              className="hub-button secondary"
              disabled={page <= 1}
              onClick={() => {
                onFilterChange?.(filter, page - 1);
                setPage((value) => value - 1);
                setSelected([]);
              }}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(resource.data.total / (resource.data.pageSize || 25)))} · {resource.data.total} matching applicants
            </span>
            <button
              className="hub-button secondary"
              disabled={
                resource.data.items.length === 0 ||
                page * (resource.data.pageSize || 25) >= resource.data.total
              }
              onClick={() => {
                onFilterChange?.(filter, page + 1);
                setPage((value) => value + 1);
                setSelected([]);
              }}
            >
              Next
            </button>
          </div>}
        </>
      )}
      {selectedJob && <JobMatchSetup key={jobId} jobId={jobId} changed={()=>void resource.reload()}/> }
      {selected.length > 0 && !allMatching && !inTrash && (
        <form className="hub-bulk" onSubmit={applyBulk}>
          <strong>{selected.length} selected</strong>
          {(resource.data?.items||[]).filter(item=>selected.includes(item.id)).every(item=>item.stage==="Screening")&&<button type="button" className="hub-button secondary" disabled={mutation.busy||filtersDirty} onClick={()=>void unshortlistSelected()}>Remove selected from shortlist</button>}
          <button type="button" className="hub-button" disabled={mutation.busy || filtersDirty || !(resource.data?.items || []).filter(item=>selected.includes(item.id)).every(item=>["Application Review","Screening"].includes(item.stage))} onClick={()=>void shortlistSelected()}>Shortlist selected</button>
          <Field label="Bulk action">
            <select
              value={bulkAction}
              onChange={(e) => {
                setBulkAction(e.target.value);
                setApprove(false);
              }}
            >
              <option value="stage">Move stage</option>
              <option value="assign">Assign reviewer</option>
              <option value="reject">Reject applications</option>
            </select>
          </Field>
          {bulkAction === "stage" && (
            <Field label="Stage">
              <select
                value={bulkStage}
                onChange={(e) => setBulkStage(e.target.value)}
              >
                {stages
                  .filter((s) => s !== "Rejected")
                  .map((s) => (
                    <option key={s} value={s}>{stageLabel(s)}</option>
                  ))}
              </select>
            </Field>
          )}
          {bulkAction === "assign" && (
            <Field label="Reviewer email">
              <input
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                type="email"
                placeholder="Blank to unassign"
              />
            </Field>
          )}
          {bulkAction === "reject" && (
            <>
              <Field label="Rejection reason">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </Field>
              <label className="hub-checkbox">
                <input
                  type="checkbox"
                  checked={approve}
                  onChange={(e) => setApprove(e.target.checked)}
                  required
                />{" "}
                I approve these rejections and their rejection emails.
              </label>
            </>
          )}
          <button
            className="hub-button"
            type="submit"
            disabled={mutation.busy || filtersDirty || (bulkAction === "reject" && !approve)}
          >
            {mutation.busy ? "Applying…" : "Apply to selected"}
          </button>
          <button
            className="hub-text-button"
            type="button"
            onClick={() => setSelected([])}
          >
            Clear selection
          </button>
          <Feedback error={mutation.error} success={mutation.success} />
        </form>
      )}
    </section>
  );
}
export function CandidateDetail({
  id,
  back,
  changed,
  initialAction = "note",
  navigationFilter = "",
  navigationJobs = [],
  openApplicant,
  initialSection = "application",
  onDecisionNotice,
}: {
  id: string;
  back: () => void;
  changed: () => void;
  initialAction?: "note" | "interview";
  navigationFilter?: string;
  navigationJobs?: HubJob[];
  openApplicant?: (id:string,filter:string,section?:"application"|"review"|"activity")=>void;
  initialSection?: "application"|"review"|"activity";
  onDecisionNotice?: (message:string,next?:string|null)=>void;
}) {
  const resource = useHubResource<ApplicationDetail>(
      "/api/hub/applications/" + encodeURIComponent(id),
    ),
    mutation = useHubMutation();
  const [section, setSection] = useState<"application" | "review" | "activity">(initialSection);
  const profileTop = useRef<HTMLElement>(null);
  const openedProfile = useRef<string|null>(null);
  useLayoutEffect(() => {
    if (resource.loading || !resource.data || resource.data.id !== id || openedProfile.current === id) return;
    openedProfile.current = id;
    // A new record starts at its identity, once. Refreshes and delayed previews must not move the reader.
    profileTop.current?.scrollIntoView({block:"start",behavior:"instant"});
    profileTop.current?.querySelector<HTMLElement>("#candidate-title")?.focus({preventScroll:true});
  }, [id, resource.loading, resource.data]);
  const [action, setAction] = useState(initialAction as string),
    [stage, setStage] = useState("Screening"),
    [text, setText] = useState(""),
    [assignee, setAssignee] = useState(""),
    [reason, setReason] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [score, setScore] = useState(""),
    [criteria, setCriteria] = useState(""),
    [attendance, setAttendance] = useState("true"),
    [renew, setRenew] = useState(false),
    [interviewerEmail, setInterviewerEmail] = useState(""),
    [emailPending, setEmailPending] = useState(false),
    [newEmailApproved, setNewEmailApproved] = useState(false),
    [approve, setApprove] = useState(false);
  const [rejectBusy,setRejectBusy]=useState(false);
  const [shortlistBusy,setShortlistBusy]=useState(false);
  const decisionBusy=rejectBusy||shortlistBusy;
  const rejectionInFlight=useRef(false);
  const stillMounted=useRef(true);
  useEffect(()=>{stillMounted.current=true;return()=>{stillMounted.current=false;};},[]);
  const [actionOpen, setActionOpen] = useState(initialAction === "interview");
  const actionPanel=useRef<HTMLElement>(null);
  useEffect(()=>{if(actionOpen)actionPanel.current?.scrollIntoView({block:"nearest",behavior:"instant"});},[actionOpen]);
  const [interviewReady, setInterviewReady] = useState(false);
  const [deleteOpen,setDeleteOpen] = useState(false);
  const [pdfBusy,setPdfBusy] = useState(false);
  const [pdfError,setPdfError] = useState("");
  const [leaveRequest,setLeaveRequest]=useState<(()=>void)|null>(null);
  const leaveDialog=useRef<HTMLDivElement>(null);
  const leaveOrigin=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{if(leaveRequest)leaveDialog.current?.focus();},[leaveRequest]);
  const evidenceDraft = useEvidenceDraft();
  const scorecardDraft = useScorecardDraft();
  const dirty = !!(evidenceDraft.notes.trim() || scorecardDraft[0].ratings.length || text.trim() || subject.trim() || body.trim() || reason.trim() || score || criteria.trim() || assignee.trim() || renew || interviewerEmail || emailPending || (actionOpen && ((action==="stage" && stage!=="Screening") || (action==="attendance" && attendance!=="true"))));
  const dirtyRef=useRef(dirty);useLayoutEffect(()=>{dirtyRef.current=dirty;},[dirty]);
  useEffect(()=>{
    const previous=window.__aiclDraftGuard;
    const guard=(leave:()=>void)=>{if(!dirtyRef.current)return previous?.(leave) || false;leaveOrigin.current=document.activeElement as HTMLElement;setLeaveRequest(()=>leave);return true;};
    window.__aiclDraftGuard=guard;
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",beforeUnload);
    return()=>{if(window.__aiclDraftGuard===guard)window.__aiclDraftGuard=previous;window.removeEventListener("beforeunload",beforeUnload);};
  },[]);
  const resumeTarget = useRef<HTMLLIElement>(null);
  const recordTabs = useRef<HTMLDivElement>(null);
  const previousSection = useRef(section);
  useLayoutEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    // A shorter panel must not retain an old bottom-of-page scroll target.
    recordTabs.current?.scrollIntoView({block:"nearest",behavior:"instant"});
  }, [section]);
  const emailRequest = useRef<{ action: string; subject: string; body: string; actionId: string; expectedRevision: number } | null>(null);
  async function exportPdf() {
    if(!resource.data||pdfBusy)return;
    setPdfBusy(true);setPdfError("");
    try {await downloadApplication(resource.data);}catch(error){setPdfError(error instanceof Error?error.message:"PDF download failed. Please try again.");}finally{setPdfBusy(false);}
  }
  async function lifecycle(action:"trash"|"restore") {
    if(!resource.data)return;
    const result=await mutation.run("/api/hub/applications/"+encodeURIComponent(id)+"/lifecycle","POST",{action,expectedRevision:resource.data.revision},action==="trash"?"Application moved to Trash. Files and history retained.":"Application restored. Cancelled emails and links remain cancelled.");
    if(result!==undefined){setDeleteOpen(false);setActionOpen(false);await resource.reload();changed();}
  }
  async function shortlist() {
    if (!resource.data || resource.data.stage !== "Application Review" || mutation.busy || rejectionInFlight.current || dirty) return;
    rejectionInFlight.current=true;setShortlistBusy(true);
    const params=reviewQueue(new URLSearchParams(navigationFilter));
    params.set("jobId",resource.data.jobId);params.delete("page");
    if(!params.has("sort"))params.set("sort","screening_newest");
    let nextId:string|null=null;let navigationReady=false;
    try {
      try {
        const navigation=await hubRequest<{nextId:string|null}>(`/api/hub/applications/${encodeURIComponent(id)}/navigation?${params}`);
        nextId=navigation.nextId;navigationReady=true;
      } catch { /* Save the decision, but never invent a successor when navigation is unavailable. */ }
      if(!stillMounted.current)return;
      const result=await mutation.run(`/api/hub/applications/${encodeURIComponent(id)}/action`,"POST",{action:"stage",stage:"Screening",expectedRevision:resource.data.revision},"Added to the shortlist. No email sent.");
      if(result!==undefined&&stillMounted.current){
        const message=navigationReady?"Added to the shortlist. No email sent.":"Added to the shortlist. No email sent. The next applicant could not be loaded; return to applications to continue.";
        onDecisionNotice?.(message,navigationReady&&openApplicant?(nextId||"list"):null);changed();
        if(navigationReady&&openApplicant){if(nextId)openApplicant(nextId,params.toString(),section);else back();}
        else await resource.reload();
      }
    } finally {rejectionInFlight.current=false;if(stillMounted.current)setShortlistBusy(false);}
  }
  async function unshortlist(){
    if(!resource.data||resource.data.stage!=="Screening"||mutation.busy||decisionBusy||dirty)return;
    const result=await mutation.run(`/api/hub/applications/${encodeURIComponent(id)}/action`,"POST",{action:"stage",stage:"Application Review",expectedRevision:resource.data.revision},"Removed from the shortlist. No email sent.");
    if(result!==undefined){await resource.reload();changed();}
  }
  async function rejectAndContinue() {
    if(!resource.data || mutation.busy || rejectionInFlight.current || dirty || ["Rejected","Withdrawn","Hired"].includes(resource.data.stage))return;
    rejectionInFlight.current=true;setRejectBusy(true);
    const params=reviewQueue(new URLSearchParams(navigationFilter));
    params.set("jobId",resource.data.jobId);params.set("active","true");params.delete("page");
    if(!params.has("sort"))params.set("sort","screening_newest");
    let nextId:string|null=null;let navigationReady=false;
    try {
      try {const result=await hubRequest<{nextId:string|null}>(`/api/hub/applications/${encodeURIComponent(id)}/navigation?${params}`);nextId=result.nextId;navigationReady=true;}catch{/* A navigation outage must not invent a successor. */}
      const result=await mutation.run(`/api/hub/applications/${encodeURIComponent(id)}/action`,"POST",{action:"reject",reason:"Not selected after recruiter review.",expectedRevision:resource.data.revision},"Applicant rejected. Rejection email queued; delivery status is in Activity.");
      if(result!==undefined&&stillMounted.current){
        const message=navigationReady?"Applicant rejected. Rejection email queued; delivery status is in Activity.":"Applicant rejected and rejection email queued. The next applicant could not be loaded; return to applications to continue.";
        onDecisionNotice?.(message,navigationReady&&openApplicant?(nextId||"list"):null);changed();
        if(navigationReady&&openApplicant){if(nextId)openApplicant(nextId,params.toString(),section);else back();}
        else await resource.reload();
      }
    } finally {rejectionInFlight.current=false;if(stillMounted.current)setRejectBusy(false);}
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if(decisionBusy)return;
    if (action === "reject" && !approve) return;
    if (action === "interview" && !interviewReady) return;
    if (!resource.data || (action === "scorecard" && (!score || !criteria.trim() || !text.trim()))) return;
    const draft = {
      action,
      expectedRevision: resource.data.revision,
      ...(["assessment", "interview"].includes(action) ? { renew } : {}),
      ...(action === "interview" && !renew && interviewerEmail && interviewerEmail !== "__shared__" ? { interviewerEmail } : {}),
      ...(action === "stage"
        ? { stage }
        : action === "assign"
          ? { assignee: assignee.trim() || null }
          : action === "reject"
            ? { reason }
            : action === "email"
              ? { subject, body }
              : action === "scorecard"
                ? { score: Number(score), criteria, text }
                : action === "attendance"
                  ? { attended: attendance === "true" }
                  : action === "interview"
                    ? {}
                    : { text }),
    };
    if (action === "email" && !emailRequest.current) {
      emailRequest.current = { action: "email", subject, body, actionId: crypto.randomUUID(), expectedRevision: resource.data.revision };
      setEmailPending(true);
      setNewEmailApproved(false);
    }
    const payload = action === "email" ? emailRequest.current : draft;
    const result = await mutation.run(
      "/api/hub/applications/" + encodeURIComponent(id) + "/action",
      "POST",
      payload,
      ["reject", "assessment", "interview", "email"].includes(action)
        ? "Decision saved. Delivery status appears in communication history."
        : "Saved to this application.",
    );
    if (result !== undefined) {
      setText("");
      setApprove(false);
      setRenew(false);
      setScore(""); setCriteria(""); setReason(""); setAssignee(""); setInterviewerEmail(""); setStage("Screening"); setAttendance("true");
      if (action === "email") { emailRequest.current = null; setEmailPending(false); setNewEmailApproved(false); setSubject(""); setBody(""); }
      await resource.reload();
      changed();
    }
  }
  const detail = resource.data;
  return (
    <section ref={profileTop} className="hub-applicant-profile" aria-labelledby="candidate-title">
      {leaveRequest && <div className="hub-card" role="alertdialog" ref={leaveDialog} tabIndex={-1} aria-labelledby="leave-applicant-title"><h3 id="leave-applicant-title">Leave this applicant without saving?</h3><p>Your unsaved note or action will be discarded. Leaving does not send a new message. Check Activity for any email already pending.</p><div className="hub-button-row"><button type="button" className="hub-button" onClick={()=>{setLeaveRequest(null);leaveOrigin.current?.focus();}}>Keep editing</button><button type="button" className="hub-button secondary" onClick={()=>{const leave=leaveRequest;dirtyRef.current=false;setLeaveRequest(null);leave();}}>Discard changes and leave</button></div></div>}
      <div className="hub-profile-topbar">
        <button className="hub-text-button hub-back" disabled={decisionBusy} onClick={()=>requestDraftNavigation(back)}><ArrowLeft size={16}/> Back to applications</button>
        {detail && !resource.loading && openApplicant && <ApplicantNavigation disabled={decisionBusy} detail={detail} filter={navigationFilter} jobs={navigationJobs} open={(id,filter)=>requestDraftNavigation(()=>openApplicant(id,filter,section))} viewed={changed}/>}
      </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {detail && !resource.loading && (
        <>
          <header className="hub-profile-header">
            <div className="hub-profile-identity">
              <div className="hub-profile-name-row"><h2 id="candidate-title" tabIndex={-1}>{answerContactName(detail)}</h2><div className="hub-status-line"><Badge>{detail.trashed?"In Trash":stageLabel(detail.stage)}</Badge><Badge tone={qualificationTone(detail.qualification)}>{qualificationLabel(detail.qualification,detail.qualificationEvidence.length>0)}</Badge>{detail.duplicateEmail && <Badge tone="warning">{detail.duplicateApplicationCount} applications share this email</Badge>}</div></div>
              <p className="hub-profile-job">{detail.jobTitle}</p>
              <p className="hub-profile-contact"><a href={"mailto:"+detail.email}>{detail.email}</a><span>Applied {displayDate(detail.createdAt)}</span><span>Assigned to {detail.assignee||"no recruiter"}</span></p>
            </div>
            <div className="hub-candidate-quick-actions" aria-label="Applicant actions">
              {!detail.trashed && detail.stage==="Application Review" && <button type="button" className="hub-button" disabled={mutation.busy||decisionBusy||dirty} title={dirty?"Save or clear unsaved changes first.":"Shortlist and open the next applicant. No email is sent."} onClick={()=>void shortlist()}>{shortlistBusy?"Shortlisting…":"Shortlist"}</button>}
              {!detail.trashed && detail.stage==="Screening" && <button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy||dirty} title={dirty?"Save or clear unsaved changes first.":"Return to initial review without sending an email."} onClick={()=>void unshortlist()}>Remove from shortlist</button>}
              {!detail.trashed&&!['Rejected','Withdrawn','Hired'].includes(detail.stage)&&<button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy||dirty} title={dirty?"Save or clear your unsaved note or action before rejecting.":"Reject and queue this job’s rejection email, then open the next active applicant."} onClick={()=>void rejectAndContinue()}>{rejectBusy?"Rejecting…":"Reject"}</button>}
              {detail.trashed && <button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy} onClick={()=>void lifecycle("restore")}>Restore application</button>}
              {!detail.trashed&&<ShareApplicant key={detail.id} id={detail.id}/>}
              <JobActionMenu label="More applicant actions" triggerLabel="More">
                {!detail.trashed && !["Rejected","Withdrawn","Hired"].includes(detail.stage) && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>{setAction("interview");setActionOpen(true);mutation.clear();}}><CalendarClock size={16} aria-hidden="true"/>Request interview</button>}
                {!detail.trashed && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>{setAction("note");setActionOpen(true);mutation.clear();}}><StickyNote size={16} aria-hidden="true"/>Add note</button>}
                {!detail.trashed && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>{setAction("stage");setActionOpen(true);mutation.clear();}}><Settings2 size={16} aria-hidden="true"/>Other applicant actions</button>}
                <button type="button" disabled={pdfBusy} onClick={()=>void exportPdf()}><Download size={16}/>{pdfBusy?"Preparing PDF…":"Download application PDF"}</button>
                <button type="button" disabled={decisionBusy} onClick={()=>void resource.reload()}><RefreshCw size={16} aria-hidden="true"/>Refresh application</button>
                {!detail.trashed && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>setDeleteOpen(true)}><Trash2 size={16} aria-hidden="true"/>Delete application</button>}
              </JobActionMenu>
            </div>
          </header>
          <Feedback error={mutation.error||pdfError} success={mutation.success}/>
          {detail.trashed && <p className="hub-muted">This application is in Trash. Its files and history are retained. Restore it before taking recruiting actions.</p>}
          {deleteOpen && <div className="hub-card" role="alertdialog" aria-labelledby="delete-application-title"><h3 id="delete-application-title">Move this application to Trash?</h3><p>It will leave your recruiting queues. Files and history stay saved, and you can restore it from this job’s Trash tab. Unsent emails and active booking links will be cancelled.</p><div className="hub-button-row"><button className="hub-button secondary" type="button" disabled={mutation.busy||decisionBusy} onClick={()=>setDeleteOpen(false)}>Keep application</button><button className="hub-button" type="button" disabled={mutation.busy||decisionBusy} onClick={()=>void lifecycle("trash")}>Move to Trash</button></div></div>}
          <div className="hub-detail-grid">
            {!detail.trashed && actionOpen && <aside ref={actionPanel} className="hub-action-panel">
              <details className="hub-card hub-candidate-actions" open={actionOpen} onToggle={event=>{const open=event.currentTarget.open;setActionOpen(open);if(!open)profileTop.current?.querySelector<HTMLElement>('summary[aria-label="More applicant actions"]')?.focus({preventScroll:true});}}>
              <summary>{action === "interview" ? "Request an interview" : "Applicant actions"}</summary>
              <p className="hub-muted">Choose an action below. Interview invitations are sent only when you click Send booking link.</p>
              <form onSubmit={submit}>
                <fieldset disabled={mutation.busy||decisionBusy||detail.trashed}>
                  <Field label="Action">
                    <select
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value);
                        if(e.target.value === "scorecard") setSection("review");
                        setText("");
                        setApprove(false);
                        setRenew(false);
                        setNewEmailApproved(false);
                        mutation.clear();
                      }}
                    >
                      <option value="note">Add internal note</option>
                      <option value="stage">Move hiring stage</option>
                      <option value="assign">Assign reviewer</option>
                      <option value="assessment">Send assessment</option>
                      <option value="interview">
                        Send interview booking link
                      </option>
                      <option value="scorecard">Record an overall grade</option>
                      <option value="attendance">
                        Record interview attendance
                      </option>
                      <option value="email">Send email</option>
                      <option value="reject">Reject application</option>
                    </select>
                  </Field>
                  {["assessment", "interview"].includes(action) && <label className="hub-checkbox"><input type="checkbox" checked={renew} onChange={(e) => setRenew(e.target.checked)} /> Send a replacement secure link and revoke the previous link. Existing responses and bookings remain in history.</label>}
                  {action === "stage" && (
                    <Field label="Stage">
                      <select
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      >
                        {stages
                          .filter((s) => s !== "Rejected")
                          .map((s) => (
                            <option key={s} value={s}>{stageLabel(s)}</option>
                          ))}
                      </select>
                    </Field>
                  )}
                  {action === "assign" && (
                    <Field
                      label="Reviewer email"
                      hint="Leave blank to unassign."
                    >
                      <input
                        type="email"
                        value={assignee}
                        onChange={(e) => setAssignee(e.target.value)}
                      />
                    </Field>
                  )}
                  {action === "reject" && (
                    <>
                      <Field label="Rejection reason">
                        <textarea
                          required
                          rows={4}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </Field>
                      <label className="hub-checkbox">
                        <input
                          type="checkbox"
                          required
                          checked={approve}
                          onChange={(e) => setApprove(e.target.checked)}
                        />{" "}
                        I approve this rejection and its rejection email.
                      </label>
                    </>
                  )}
                  {(action === "note" ||
                    action === "assessment" ||
                    action === "scorecard") && (
                    <Field
                      label={
                        action === "assessment"
                          ? "Assessment prompt"
                          : action === "scorecard"
                            ? "Review notes"
                            : "Internal note"
                      }
                      hint={
                        action === "assessment"
                          ? "Leave blank to use the role’s saved assessment prompt. A secure link is sent to this candidate."
                          : undefined
                      }
                    >
                      <textarea
                        rows={5}
                        disabled={action === "assessment" && renew}
                        required={action === "note" || action === "scorecard"}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                      {action === "assessment" && renew && <p className="hub-muted">A replacement link keeps the existing assessment prompt and response. Clear replacement mode to initiate a different assessment.</p>}
                    </Field>
                  )}
                  {action === "interview" && (
                    <><p className="hub-muted">Send this applicant a private link to choose an interview time.</p><InterviewBookingChoice applicationId={id} value={interviewerEmail} change={setInterviewerEmail} renew={renew} ready={setInterviewReady}/></>
                  )}
                  {action === "email" && (
                    <>
                      <Field label="Subject">
                        <input
                          required
                          value={subject}
                          disabled={emailPending}
                          onChange={(e) => setSubject(e.target.value)}
                        />
                      </Field>
                      <Field label="Email body">
                        <textarea
                          rows={7}
                          required
                          value={body}
                          disabled={emailPending}
                          onChange={(e) => setBody(e.target.value)}
                        />
                      </Field>
                      {emailPending && <div className="hub-notice"><p>This email is awaiting confirmation. Check the original request again; its request ID prevents a second email. Delivery status appears in communication history.</p><p>To write another message, refresh this application and review communication history first.</p><label className="hub-checkbox"><input type="checkbox" checked={newEmailApproved} onChange={(e) => setNewEmailApproved(e.target.checked)} /> I reviewed communication history and intend to send a new message.</label><button type="button" className="hub-button secondary" disabled={!newEmailApproved} onClick={() => {emailRequest.current=null;setEmailPending(false);setNewEmailApproved(false);setSubject("");setBody("");mutation.clear();}}>Start a new email</button></div>}
                    </>
                  )}
                  {action === "scorecard" && (
                    <>
                      <Field label="Overall reviewer grade" hint="Use the same approved criteria for everyone applying to this role. 1 = below requirements, 3 = meets requirements, 5 = exceptional evidence.">
                        <select
                          required
                          value={score}
                          onChange={(e) => setScore(e.target.value)}
                        >
                          <option value="">Choose a grade</option>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} / 5
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Evaluation criteria" hint="Name the role requirements or assessment criteria supporting your overall grade.">
                        <input
                          required
                          value={criteria}
                          onChange={(e) => setCriteria(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  {action === "attendance" && (
                    <Field label="Candidate attended">
                      <select
                        value={attendance}
                        onChange={(e) => setAttendance(e.target.value)}
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </Field>
                  )}
                  <button
                    className={
                      "hub-button " + (action === "reject" ? "danger" : "")
                    }
                    type="submit"
                    disabled={mutation.busy || (action === "reject" && !approve) || (action === "interview" && !interviewReady)}
                  >
                    {mutation.busy
                      ? "Saving…"
                      : action === "assessment"
                        ? "Send assessment"
                        : action === "interview"
                          ? "Send booking link"
                          : action === "email"
                            ? emailPending ? "Check previous email" : "Send email"
                            : action === "reject"
                              ? "Reject application"
                              : "Save action"}
                  </button>
                </fieldset>
              </form>
              </details>
            </aside>}
            <div className="hub-detail-main">
              <div ref={recordTabs} className="hub-button-row hub-profile-tabs" role="tablist" aria-label="Applicant record">{([{id:"application",label:"Application & files"},{id:"review",label:"AI review & notes"},{id:"activity",label:"Activity & messages"}] as const).map(tab=><button key={tab.id} type="button" role="tab" id={`candidate-tab-${tab.id}`} aria-selected={section===tab.id} tabIndex={section===tab.id?0:-1} onKeyDown={event=>{const ids=["application","review","activity"] as const;const index=ids.indexOf(section);const next=event.key==="ArrowRight"?ids[(index+1)%3]:event.key==="ArrowLeft"?ids[(index+2)%3]:event.key==="Home"?ids[0]:event.key==="End"?ids[2]:null;if(next){event.preventDefault();setSection(next);document.getElementById(`candidate-tab-${next}`)?.focus({preventScroll:true});}}} aria-controls={`candidate-panel-${tab.id}`} className={"hub-button " + (section===tab.id ? "" : "secondary")} onClick={()=>setSection(tab.id)}>{tab.label}</button>)}</div>
              <div role="tabpanel" id="candidate-panel-review" aria-labelledby="candidate-tab-review" hidden={section!=="review"}>
              {section === "review" && <CandidateMatch applicationId={detail.id}/>}
              <section className="hub-card hub-candidate-notes"><div className="hub-section-heading compact"><h3>Recruiter notes</h3><button type="button" className="hub-text-button" onClick={()=>{setAction("note");setActionOpen(true);}}>Add note</button></div>{detail.notes.length ? detail.notes.slice(0,5).map(note=><article className="hub-history-item" key={note.id}><strong>{note.actor}</strong>{note.text.length>500 ? <details><summary>Read note · {displayDate(note.createdAt)}</summary><p className="hub-preserve">{note.text}</p></details> : <><p className="hub-preserve">{note.text}</p><small>{displayDate(note.createdAt)}</small></>}</article>) : <p className="hub-muted">No notes yet.</p>}</section>
              <details className="hub-card"><summary>Optional: human grades and scorecards</summary>
              <section className="hub-card">
                <h3>Reviewer grade</h3>
                <GradeSummary grade={detail.grade} />
                <details><summary>How the shortlist is sorted</summary><p>The latest grade from each reviewer counts once, with equal weight. Compare candidates applying to the same job posting with the same approved criteria. A 4/5 mean displays as 80/100. Ungraded candidates stay ungraded. In Applications, choose the posting and sort by highest reviewer grade. Qualification rules and AI summaries do not change this grade.</p></details>
                {detail.grade?.latestReviews.map((review) => <article className="hub-history-item" key={review.actor}><strong>{review.actor} · {review.score}/5</strong><p>{review.criteria}</p><p className="hub-preserve">{review.text}</p><small>{displayDate(review.createdAt)}</small></article>)}
                {detail.grade?.reviewerCount === 1 && <p className="hub-notice">One reviewer has graded this application. A second or third review can give you more evidence before deciding.</p>}
              </section>
              <ReusableScorecard detail={detail} draft={scorecardDraft} saved={() => { void resource.reload(); changed(); }} />
              </details>
              <details className="hub-card"><summary>Advanced: evidence and verification tools</summary>
              <CandidateEvidence key={detail.id} detail={detail} draft={evidenceDraft} saved={() => { void resource.reload(); changed(); }} />
              </details>
              </div>
              <div role="tabpanel" id="candidate-panel-application" aria-labelledby="candidate-tab-application" hidden={section!=="application"}>
              <section className="hub-card">
                <h3>Application answers</h3>
                <ApplicationAnswers detail={detail}/>
                <h4>Original files</h4>
                {detail.files.length ? (
                  <ul className="hub-file-list">
                    {detail.files.map((file) => (
                      <li key={file.id} ref={file.id===resumeFile(detail)?.id?resumeTarget:undefined} tabIndex={file.id===resumeFile(detail)?.id?-1:undefined} style={{scrollMarginTop:24}}>
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download size={16} /> {file.filename} — Download
                        </a>
                        <span>
                          {Math.ceil(file.size / 1024)} KB · {({"application/pdf":"PDF", "application/msword":"Word document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"Word document", "image/png":"PNG image", "image/jpeg":"JPEG image", "image/webp":"WebP image"} as Record<string,string>)[file.contentType] || "Original file"}
                        </span>
                        {section === "application" && file.id===resumeFile(detail)?.id && <ResumePreview detail={detail}/>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hub-muted">No original files attached.</p>
                )}
                {detail.driveFolderUrl && (
                  <a
                    className="hub-text-button"
                    href={detail.driveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Drive archive <ExternalLink size={14} />
                  </a>
                )}
              </section>
              <section className="hub-card">
                <h3>Qualification evidence</h3>
                {detail.qualificationEvidence.length ? (
                  <ul className="hub-evidence-list">
                    {detail.qualificationEvidence.map((evidence, index) => (
                      <li key={index}>
                        <Badge
                          tone={
                            missingAnswer(evidence.value)
                              ? "warning"
                              : evidence.matched
                                ? "success"
                                : "danger"
                          }
                        >
                          {missingAnswer(evidence.value)
                            ? "Answer missing"
                            : evidence.matched
                              ? "Requirement met"
                              : "Requirement not met"}
                        </Badge>
                        <strong>
                          {detail.fields.find(
                            (field) => field.path === evidence.fieldPath,
                          )?.title || evidence.fieldPath}
                        </strong>
                        <p>Rejection reason if unmet: {evidence.reason}</p>
                        <p className="hub-muted">
                          Answer: {displayAnswer(evidence.value)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hub-muted">
                    This job has no enabled screening rules. The AI match compares the résumé and answers with the job description separately.
                  </p>
                )}
              </section>
              </div>
              <div role="tabpanel" id="candidate-panel-activity" aria-labelledby="candidate-tab-activity" hidden={section!=="activity"}>
              {(detail.assessments || (detail.assessment ? [detail.assessment] : [])).map((assessment, index) => (
                <section className="hub-card" key={assessment.id}>
                  <div className="hub-section-heading compact">
                    <h3>Assessment {index === 0 ? "· latest" : "· previous"}</h3>
                    <Badge>{assessment.status}</Badge>
                  </div>
                  <p className="hub-preserve">{assessment.prompt}</p>
                  <h4>Candidate response</h4>
                  <p className="hub-preserve">
                    {assessment.answer || "No response submitted yet."}
                  </p>
                  {assessment.submittedAt && (
                    <small>
                      Submitted {displayDate(assessment.submittedAt)}
                    </small>
                  )}
                  {assessment.linkExpiresAt && <p className="hub-muted">Secure link {assessment.linkActive ? "active" : "unavailable"} · expires {displayDate(assessment.linkExpiresAt)}. Use Send assessment to renew it.</p>}
                </section>
              ))}
              {(detail.interviews || (detail.interview ? [detail.interview] : [])).map((interview, index) => (
                <section className="hub-card" key={interview.id}>
                  <div className="hub-section-heading compact">
                    <h3>Interview {index === 0 ? "· latest" : "· previous"}</h3>
                    <Badge>{interview.status}</Badge>
                  </div>
                  <p>
                    {displayDate(interview.start, interview.timeZone)}
                    {interview.timeZone &&
                      " · " + interview.timeZone}
                  </p>
                  {interview.status === "booked" && interview.meetUrl && (
                    <a
                      className="hub-text-button"
                      href={interview.meetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Google Meet <ExternalLink size={14} />
                    </a>
                  )}
                  <p className="hub-muted">
                    Booking and changes are controlled through the candidate’s
                    secure email link.
                  </p>
                  {interview.linkExpiresAt && <p className="hub-muted">Secure link {interview.linkActive ? "active" : "unavailable"} · expires {displayDate(interview.linkExpiresAt)}. Use Send interview booking link to renew it.</p>}
                </section>
              ))}
              <section className="hub-card">
                <h3>Previous scorecard reviews</h3>
                {detail.scorecards.length ? (
                  detail.scorecards.map((card) => (
                    <article className="hub-history-item" key={card.id}>
                      <div>
                        <strong>{card.actor}</strong>
                        <Badge>{card.score}/5</Badge>
                      </div>
                      <p>{card.criteria}</p>
                      <p className="hub-preserve">{card.text}</p>
                      <small>{displayDate(card.createdAt)}</small>
                    </article>
                  ))
                ) : (
                  <p className="hub-muted">
                    No scorecards yet. Use AI review & notes to record a review.
                  </p>
                )}
              </section>
              <section className="hub-card">
                <h3>Notes</h3>
                {detail.notes.length ? (
                  detail.notes.map((note) => (
                    <article className="hub-history-item" key={note.id}>
                      <strong>{note.actor}</strong>
                      <p className="hub-preserve">{note.text}</p>
                      <small>{displayDate(note.createdAt)}</small>
                    </article>
                  ))
                ) : (
                  <p className="hub-muted">No internal notes yet.</p>
                )}
              </section>
              <section className="hub-card">
                <h3>Communication history</h3>
                {detail.communications.length ? (
                  detail.communications.map((message) => (
                    <article className="hub-history-item" key={message.id}>
                      <div>
                        <strong>{message.purpose || "Email"} · {communicationSummary(message.status).label.toLowerCase()}</strong>

                      </div>
                      <small>{communicationSummary(message.status).explanation}</small>
                      <details><summary>View message</summary><strong>{message.subject}</strong><p className="hub-preserve">{message.body}</p></details>
                      <small>{displayDate(message.createdAt)}</small>
                    </article>
                  ))
                ) : (
                  <p className="hub-muted">
                    No messages yet. Assessments and interviews require an
                    explicit recruiter action.
                  </p>
                )}
              </section>
              <section className="hub-card">
                <h3>Hiring history</h3>
                {detail.history.length ? (
                  <ol className="hub-history-list">
                    {detail.history.map((event) => {const summary=activitySummary(event);return (
                      <li key={event.id}>
                        <strong>{summary.title}</strong>
                        {summary.description && (event.type==="note" || summary.description.length>240 ? <details><summary>View details</summary><p className="hub-preserve">{summary.description}</p></details> : <p>{summary.description}</p>)}
                        {summary.review && <button type="button" className="hub-text-button" onClick={()=>{setSection("review");document.getElementById("candidate-tab-review")?.focus({preventScroll:true});}}>View AI review</button>}
                        <small>
                          {event.actor} · {displayDate(event.createdAt)}
                        </small>
                      </li>
                    );})}
                  </ol>
                ) : (
                  <p className="hub-muted">No hiring events recorded.</p>
                )}
              </section>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
