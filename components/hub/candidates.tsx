"use client";
import {isHistoricalInterview} from "../../lib/hub/interview-history";
import { ApplicantCollections } from "./applicant-collections";
import { countryOptions } from "../../lib/countries";
import {interviewCancelOutcome,interviewNavigationOutcome} from "./interview-draft-state";
import {InterviewComposer,InterviewDiscardConfirmation,type InterviewDraftPayload} from "./interview-composer";
import { INTERVIEW_VIEW_LABELS } from "../../lib/hub/interview-progress";
import { ApplicantStageBadges, interviewProgressLabels } from "./interview-progress";
import { normalizeApplicantScope, applicantStageChoice, applyApplicantStageChoice } from "./applicant-stage-filter";
import { ResponseCheckPanel } from "./response-checks";
import { ClaimRadar } from "./claim-radar";
import { NavigationLink, applicantHref } from "./navigation-link";
import {ShareApplicant} from "./share-applicant";
import {BulkRejection} from "./bulk-rejection";
import { WorkflowReview, type InterviewHandoffReview } from "./workflow-review";
import { RecordingPanel } from "./interview-workspace";
import { RecruiterNotes } from "./recruiter-notes";
import { ApplicantMessages } from "./applicant-messages";
import {activitySummary} from "./activity-summary";
import { ApplicationAnswers, answerContactName } from "./application-answers";
import { JobActionMenu } from "./action-menu";
import { ApplicantNavigation, ResumePreview, resumeFile } from "./application-review-tools";
import { requestDraftNavigation } from "./draft-navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarClock, Download, ExternalLink, StickyNote, Settings2, RefreshCw, Trash2, UserCheck } from "lucide-react";
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
import { jobLocation } from "./job-organization";
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

const reviewQueue = normalizeApplicantScope;
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
function InterviewActionFrame({interview,panelRef,cancel,busy,children}:{interview:boolean;panelRef:React.RefObject<HTMLElement|null>;cancel:()=>void;busy:boolean;children:React.ReactNode}) {
 const dialog=useRef<HTMLDialogElement|null>(null);
 const outsideDown=useRef(false);
 useLayoutEffect(()=>{if(!interview||!dialog.current)return;const el=dialog.current,origin=document.activeElement as HTMLElement|null;el.showModal();return()=>{el.close();if(origin?.isConnected&&origin.getClientRects().length)origin.focus({preventScroll:true});else document.querySelector<HTMLElement>('summary[aria-label="More applicant actions"]')?.focus({preventScroll:true})}},[interview]);
 if(!interview)return <aside ref={panelRef} className="hub-action-panel">{children}</aside>;
 return <dialog className="hub-interview-dialog" aria-labelledby="hub-invitation-title" ref={el=>{dialog.current=el;panelRef.current=el}} onCancel={event=>{event.preventDefault();if(!busy)cancel()}} onPointerDown={event=>{const box=event.currentTarget.getBoundingClientRect();outsideDown.current=event.target===event.currentTarget&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)}} onClick={event=>{if(busy||!outsideDown.current||event.target!==event.currentTarget)return;outsideDown.current=false;const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)cancel()}}>{children}</dialog>;
}
function ApplicantActionCard({interview,open,toggle,children}:{interview:boolean;open:boolean;toggle:(open:boolean)=>void;children:React.ReactNode}){return interview?<section className="hub-card hub-candidate-actions">{children}</section>:<details className="hub-card hub-candidate-actions" open={open} onToggle={event=>toggle(event.currentTarget.open)}>{children}</details>;}
const queueColumns=["screening","match","owner","applied"] as const;
const columnLabels={screening:"Screening",match:"AI job match",owner:"Owner",applied:"Applied"};
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
  hrefFor, screeningConfigured, sort, optionalColumns=queueColumns, roleInIdentity=false, allowAiSort=true, onSort, qualification, assignee, onColumnFilter,
}: {
  items: ApplicationSummary[];
  select: (id: string) => void;
  hrefFor?: (item:ApplicationSummary)=>string;
  selected?: string[];
  toggle?: (id: string) => void;
  togglePage?: () => void;
  shortlist?: (item: ApplicationSummary) => void;
  unshortlist?: (item: ApplicationSummary) => void;
  interview?: (item: ApplicationSummary) => void;
  busy?: boolean;
  showRole?: boolean;
  screeningConfigured?: boolean;
  sort?: string; optionalColumns?:readonly string[]; roleInIdentity?:boolean; allowAiSort?:boolean; onSort?: (value:string)=>void;
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
            {showRole && !roleInIdentity && <th scope="col" role="columnheader">Role</th>}
            <th scope="col" role="columnheader">Stage</th>
            {optionalColumns.includes("screening")&&<th scope="col" role="columnheader" aria-sort={sort==="screening_asc"?"ascending":sort==="screening_desc"?"descending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="screening_asc"?"screening_desc":"screening_asc")}>Screening <span aria-hidden="true">{sort==="screening_asc"?"↓":sort==="screening_desc"?"↑":"↕"}</span></button>:"Screening"}{onColumnFilter && !cardLayout&&<JobActionMenu label="Filter Screening" triggerLabel={qualification?"Filtered":"Filter"}><label className="hub-column-filter">Screening result<select aria-label="Filter screening result" value={qualification||""} onChange={event=>onColumnFilter("qualification",event.target.value)}><option value="">All results</option><option value="pass">Requirements met</option><option value="review">No automatic decision</option><option value="fail">Requirement not met</option></select></label></JobActionMenu>}</th>}
            {optionalColumns.includes("match")&&<th scope="col" role="columnheader" aria-sort={sort==="ai_match_desc"?"descending":sort==="ai_match_asc"?"ascending":"none"}>{onSort && allowAiSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="ai_match_desc"?"ai_match_asc":"ai_match_desc")}>AI job match <span aria-hidden="true">{sort==="ai_match_desc"?"↓":sort==="ai_match_asc"?"↑":"↕"}</span></button>:"AI job match"}</th>}
            {optionalColumns.includes("owner")&&<th scope="col" role="columnheader" className="hub-optional-owner" aria-sort={sort==="owner_asc"?"ascending":sort==="owner_desc"?"descending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="owner_asc"?"owner_desc":"owner_asc")}>Owner <span aria-hidden="true">{sort==="owner_asc"?"↓":sort==="owner_desc"?"↑":"↕"}</span></button>:"Owner"}{onColumnFilter && !cardLayout&&<JobActionMenu label="Filter Owner" triggerLabel={assignee?"Filtered":"Filter"}><form className="hub-column-filter" key={assignee||"any"} onSubmit={event=>{event.preventDefault();onColumnFilter("assignee",String(new FormData(event.currentTarget).get("owner")||"").trim());}}><label>Recruiter email<input aria-label="Filter owner email" name="owner" type="email" defaultValue={assignee||""}/></label><button type="submit">Apply owner filter</button><button type="button" onClick={()=>onColumnFilter("assignee","")}>All owners</button></form></JobActionMenu>}</th>}
            {optionalColumns.includes("applied")&&<th scope="col" role="columnheader" className="hub-optional-applied" aria-sort={sort==="newest"?"descending":sort==="oldest"?"ascending":"none"}>{onSort && !cardLayout?<button type="button" className="hub-table-sort" onClick={()=>onSort(sort==="newest"?"oldest":"newest")}>Applied <span aria-hidden="true">{sort==="newest"?"↓":sort==="oldest"?"↑":"↕"}</span></button>:"Applied"}</th>}
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
                <NavigationLink
                  href={hrefFor?.(item)||applicantHref(item.id,"",item.jobId)}
                  className="hub-text-button hub-candidate-name"
                  navigate={() => select(item.id)}
                >
                  {item.name || "Unnamed applicant"}
                </NavigationLink>
                {showRole && roleInIdentity && <span className="hub-secondary-line aq-candidate-role">{item.jobTitle}</span>}
                <span className="hub-secondary-line">{item.email}</span>
                <span title={item.viewedAt?`Viewed by you ${displayDate(item.viewedAt)}`:"No recorded view by you yet. This does not mean a new application."}><Badge tone={item.viewedAt?"neutral":"success"}>{item.viewedAt?"Viewed":"New to you"}</Badge></span>
                {item.duplicateEmail && <Badge tone="warning">Shared email · {item.duplicateApplicationCount || 2} applications</Badge>}
              </td>
              {showRole && !roleInIdentity && <td role="cell" data-label="Role">{item.jobTitle}</td>}
              <td role="cell" data-label="Stage">
                <ApplicantStageBadges application={item}/>
                {!!item.notesReview?.hasUnread&&<Badge tone="warning">New notes</Badge>}
              </td>
              {optionalColumns.includes("screening")&&<td role="cell" data-label="Screening">
                <span title={item.qualification === "review" ? screeningConfigured === false ? "This job has no enabled screening rules. The AI match is shown separately." : "An answer needed by the screening rules is missing or could not be evaluated. Check the application answers. The AI match is shown separately." : undefined}><Badge tone={qualificationTone(item.qualification)}>{qualificationLabel(item.qualification, screeningConfigured)}</Badge></span>
              </td>}
              {optionalColumns.includes("match")&&<td role="cell" data-label="AI job match"><MatchScore match={item.aiMatch} /></td>}
              {optionalColumns.includes("owner")&&<td role="cell" data-label="Owner" className="hub-optional-owner">{item.assignee || "Unassigned"}</td>}
              {optionalColumns.includes("applied")&&<td role="cell" data-label="Applied" className="hub-nowrap hub-optional-applied">{displayDate(item.createdAt)}</td>}
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
  onSelect?: (id: string, action?: "interview", filter?: string) => void; onFilterChange?: (filter: string, page: number, replace?: boolean) => void;
};

type QueueRow = Pick<ApplicationSummary, "id"|"stage"|"revision">;
type QueueSnapshot = {items:QueueRow[];selectionId:string};
type GroupInfo = {id:string;name:string};
const defaultQueueSort = "screening_newest";
const sortLabels: Record<string,string> = {
  list_order:"List order", screening_newest:"Requirements met, then newest", newest:"Newest applications", oldest:"Oldest applications",
  owner_asc:"Owner A–Z", owner_desc:"Owner Z–A", screening_asc:"Requirements met first", screening_desc:"Unmet requirements first",
  ai_match_desc:"Highest AI match first", ai_match_asc:"Lowest AI match first", grade_desc:"Highest reviewer grade first",
};
const roleSorts = ["ai_match_asc","ai_match_desc","grade_desc"];
function queueParams(value: string) {
  const params = reviewQueue(new URLSearchParams(value));
  params.delete("page");
  if (!params.get("jobId")) {
    if (roleSorts.includes(params.get("sort")||"")) params.delete("sort");
    params.delete("top");params.delete("grade");
  }
  if(params.get("sort")==="list_order" && !params.has("listId"))params.delete("sort");
  if (!params.has("sort")) params.set("sort",defaultQueueSort);
  if (!params.has("appliedFrom")&&!params.has("appliedTo")) params.delete("timeZone");
  params.sort();
  return params;
}
export function Candidates({jobs,refresh,changed,reviewerEmail,initialStage="",initialJobId="",initialFilter="",initialPage=1,onSelect,onFilterChange}:CandidatesProps) {
  const incoming = new URLSearchParams(initialFilter);
  if (initialJobId) incoming.set("jobId",initialJobId);
  if (initialStage) incoming.set("stage",initialStage);
  const incomingFilter=queueParams(incoming.toString()).toString();
  const [filter,setFilter]=useState(incomingFilter),[page,setPage]=useState(initialPage);
  const params = new URLSearchParams(filter);
  const val=(key:string)=>params.get(key)||"";
  const [search,setSearch]=useState(val("q"));
  const [selection,setSelection]=useState<QueueRow[]>([]),[snapshotId,setSnapshotId]=useState(""),[selecting,setSelecting]=useState(false);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
  const [bulkAction,setBulkAction]=useState(""),[bulkStage,setBulkStage]=useState("Screening"),[bulkAssignee,setBulkAssignee]=useState("");
  const [detail,setDetail]=useState<{id:string;action?:"interview"}|null>(null);
  const [countryChoice,setCountryChoice]=useState("");
  const [showFilters,setShowFilters]=useState(false),[selectMode,setSelectMode]=useState(false);
  const epoch=useRef(0);
  const jobId=val("jobId"),groupId=val("jobGroupId"),listId=val("listId"),inTrash=val("trash")==="true";
  const selectedJob=jobs.find(job=>job.id===jobId);
  const groups=useHubResource<{groups:GroupInfo[]}>("/api/hub/job-groups",refresh);
  const owners=useHubResource<{staff:{email:string}[]}>("/api/job-team",refresh);
  const ownerChoices=[...new Set([reviewerEmail,...(owners.data?.staff||[]).map(s=>s.email),val("assignee")].filter(email=>email && email!=="unassigned"))];
  const scopeName=selectedJob?.title || (jobId?"Unavailable posting":groupId ? groups.data?.groups?.find(g=>g.id===groupId)?.name || "Job group" : listId ? "Candidate list" : "All roles");
  const path="/api/hub/applications?"+filter+"&page="+page;
  const resource=useHubResource<ApplicationList & {scopeTotal?:number;pageSize?:number}>(path,refresh);
  const data=resource.dataPath===path?resource.data:null;
  const loading=resource.loading || !data;
  const blocked=busy||selecting||loading||!!resource.error||search.trim()!==val("q");
  const total=data?.total || 0, scopeTotal=data?.scopeTotal ?? total;
  const ids=selection.map(r=>r.id);
  const isAll=!!snapshotId;
  const columns=val("columns")?queueColumns.filter(c=>val("columns").split(",").includes(c)):[...queueColumns];
  const countries=val("country").split(",").filter(Boolean);
  function clearSelection(){epoch.current++;setSelection([]);setSnapshotId("");setBulkAction("");setSelectMode(false);}
  function applyView(value:string,replace=false) {
    const next=queueParams(value);
    setSearch(next.get("q")||"");setCountryChoice("");
    clearSelection();setError("");setNotice("");setFilter(next.toString());setPage(1);
    onFilterChange?.(next.toString(),1,replace);
  }
  const previousIncoming=useRef({incomingFilter,initialPage});
  useEffect(()=>{
    const previous=previousIncoming.current;previousIncoming.current={incomingFilter,initialPage};
    if(previous.incomingFilter===incomingFilter && previous.initialPage===initialPage)return;
    let cancelled=false;
    queueMicrotask(()=>{if(cancelled)return;setPage(initialPage);if(previous.incomingFilter!==incomingFilter){setFilter(incomingFilter);setSearch(new URLSearchParams(incomingFilter).get("q")||"");clearSelection();}});
    return()=>{cancelled=true;};
  },[incomingFilter,initialPage]);
  function update(changes:Record<string,string|null>) {
    const next=new URLSearchParams(filter);
    for(const [key,value] of Object.entries(changes)){if(value)next.set(key,value);else next.delete(key);}
    if((changes.appliedFrom || changes.appliedTo)&&!next.has("timeZone"))next.set("timeZone",Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");
    if(changes.sort && changes.sort!=="ai_match_desc")next.delete("top");
    applyView(next.toString());
  }
  useEffect(()=>{
    const q=search.trim(), next=new URLSearchParams(filter);if(q===(next.get("q")||""))return;
    if(q)next.set("q",q);else next.delete("q");
    const timer=window.setTimeout(()=>applyView(next.toString(),true),300);
    return()=>window.clearTimeout(timer);
    // User edits update URL after typing; navigating adopts the URL directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[search,filter]);
  const waitingForAi=data?.items.some(item=>item.aiMatch?.retryPending || ["pending","preparing","running"].includes(item.aiMatch?.status||""));
  const reload=resource.reload;
  useEffect(()=>{if(!waitingForAi||selection.length)return;const timer=setInterval(()=>void reload(),15000);return()=>clearInterval(timer);},[waitingForAi,reload,selection.length]);
  function open(id:string,action?:"interview"){clearSelection();if(onSelect)onSelect(id,action,filter);else setDetail({id,action});}
  function toggle(rows:QueueRow[]) {
    if(blocked)return;
    epoch.current++;setSnapshotId("");setBulkAction("");
    const remove=rows.every(row=>ids.includes(row.id));
    const removeIds=new Set(rows.map(row=>row.id));
    setSelection(current=>remove?current.filter(row=>!removeIds.has(row.id)):[...current,...rows.filter(row=>!current.some(old=>old.id===row.id)).map(({id,stage,revision})=>({id,stage,revision}))]);
  }
  async function selectAll() {
    if(blocked||!total)return;
    const current=++epoch.current;setSelecting(true);setError("");
    try{const snapshot=await hubRequest<QueueSnapshot>("/api/hub/application-selections?"+filter,"POST",{});
      if(current===epoch.current){setSelection(snapshot.items);setSnapshotId(snapshot.selectionId);setBulkAction("");}
    }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:"Selection failed.");}finally{setSelecting(false);}
  }
  function turnPage(n:number){setPage(n);onFilterChange?.(filter,n);}
  function resetFilters(){
    const next=new URLSearchParams({active:"false"});
    for(const key of ["jobId","jobGroupId","listId","trash"])if(val(key))next.set(key,val(key));
    applyView(next.toString());
  }
  async function download(format:"csv"|"zip"){
    if(blocked)return;setBusy(true);setError("");setNotice("");
    try{
      const search=new URLSearchParams(filter);search.set("format",format);
      if(snapshotId)search.set("selectionId",snapshotId);
      else if(ids.length || (!jobId&&!groupId&&!listId)){
        const snap=await hubRequest<QueueSnapshot>("/api/hub/application-selections?"+filter,"POST",ids.length?{ids}:{});
        search.set("selectionId",snap.selectionId);
      }
      const url="/api/hub/applications-export?"+search;
      const check=await fetch(url+"&check=1",{credentials:"same-origin",cache:"no-store"});
      if(!check.ok){const response=await check.json() as {error?:{message?:string}};throw new Error(response?.error?.message||"Download could not be prepared.");}
      const link=document.createElement("a");link.href=url;link.download="applications."+format;document.body.appendChild(link);link.click();link.remove();
      setNotice("Download started. Check your browser’s downloads.");
    }catch(e){setError(e instanceof Error?e.message:"Download failed.");}finally{setBusy(false);}
  }
  async function setApplicationStage(row:ApplicationSummary,stage:string){
    if(blocked)return;setBusy(true);setNotice("");setError("");
    try{await hubRequest("/api/hub/applications/"+encodeURIComponent(row.id)+"/action","POST",{action:"stage",stage,expectedRevision:row.revision});clearSelection();changed();await reload();}catch(e){setError(e instanceof Error?e.message:"Stage change failed.");}finally{setBusy(false);}
  }
  async function applyBulk(){
    if(blocked||!selection.length||!["assign","stage"].includes(bulkAction))return;
    setBusy(true);setNotice("");setError("");
    let updated=0;
    try{
      for(let offset=0;offset<selection.length;offset+=100){
        const batch=selection.slice(offset,offset+100);
        await hubRequest("/api/hub/bulk","POST",{ids:batch.map(r=>r.id),expectedRevisions:Object.fromEntries(batch.map(r=>[r.id,r.revision])),action:bulkAction,...(bulkAction==="stage"?{stage:bulkStage}:{assignee:bulkAssignee||null})});
        updated+=batch.length;setNotice(updated+" of "+selection.length+" applications updated.");
      }
      clearSelection();
    }catch(e){setError((updated ? updated+" applications updated. " : "")+(e instanceof Error?e.message:"Bulk action failed.")+" Refresh before retrying.");clearSelection();}
    finally{setBusy(false);changed();void reload();}
  }
  const chips:{key:string;label:string;changes:Record<string,string|null>}[]=[];
  function chip(key:string,label:string,changes:Record<string,string|null>={[key]:null}){chips.push({key,label,changes});}
  if(jobId||groupId)chip("role",scopeName,{jobId:null,jobGroupId:null,grade:null,top:null});
  if(listId)chip("listId","Candidate list");
  const stageChoice=applicantStageChoice(params);
  if(!inTrash && stageChoice!=="all")chip("stage",val("stage")?stageLabel(val("stage")):val("excludeStage")?"In progress · excluding "+stageLabel(val("excludeStage")):"In progress",{stage:null,excludeStage:null,active:"false"});
  if(val("interviewProgress"))chip("interviewProgress",({...INTERVIEW_VIEW_LABELS,...interviewProgressLabels} as Record<string,string>)[val("interviewProgress")]||val("interviewProgress"));
  if(val("assignee"))chip("assignee","Owner: "+(val("assignee")==="unassigned"?"Unassigned":val("assignee")));
  if(val("qualification"))chip("qualification",qualificationLabel(val("qualification")));
  if(val("q"))chip("q","Search: "+val("q"));
  if(val("top"))chip("top","Top 10 AI matches");
  if(val("grade"))chip("grade",val("grade")==="reviewed"?"Graded":"Ungraded");
  if(val("duplicate"))chip("duplicate","Shared email");
  if(val("handoffReturned"))chip("handoffReturned","Returned handoffs");
  if(val("appliedFrom"))chip("appliedFrom","From "+val("appliedFrom"));
  if(val("appliedTo"))chip("appliedTo","Through "+val("appliedTo"));
  for (const code of countries)chip("country-"+code,countryOptions.find(c=>c.value===code)?.label||code,{country:countries.filter(c=>c!==code).join(",")});
  if(detail)return <CandidateDetail key={detail.id} id={detail.id} initialAction={detail.action || "note"} navigationFilter={filter} navigationJobs={jobs} back={()=>setDetail(null)} changed={changed} onDecisionNotice={setNotice} openApplicant={id=>setDetail({id})}/>;
  return <section className="hub-candidate-browser applicant-queue" aria-labelledby="candidates-title">
    <div className="hub-section-heading compact"><div><h2 id="candidates-title">{inTrash?"Applications in Trash":selectedJob?.title||"Applicants"}</h2>
      <p aria-live="polite">{data?`${total.toLocaleString()} of ${scopeTotal.toLocaleString()} applications · ${scopeName}`:"Loading applications…"}</p></div>
      <JobActionMenu label="Application options" triggerLabel="Options">
        <fieldset className="aq-columns"><legend>Visible columns</legend>{queueColumns.map(col=><label key={col}>
          <input type="checkbox" aria-label={"Show "+columnLabels[col]+" column"} checked={columns.includes(col)} onChange={e=>{
            const next=queueColumns.filter(c=>c===col?e.target.checked:columns.includes(c));
            update({columns:next.length===queueColumns.length?null:next.join(",")||"none"});
          }}/> {columnLabels[col]}</label>)}</fieldset>
        <button type="button" disabled={blocked||!total} onClick={()=>void download("zip")}>Download {ids.length?"selected":"matching"} ZIP ({ids.length||total})</button>
        <button type="button" disabled={blocked||!total} onClick={()=>void download("csv")}>Export {ids.length?"selected":"matching"} CSV ({ids.length||total})</button>
        <button type="button" onClick={()=>void reload()}>Refresh applications</button>
        <button type="button" onClick={()=>{const next=new URLSearchParams();if(jobId)next.set("jobId",jobId);if(!inTrash)next.set("trash","true");applyView(next.toString());}}>{inTrash?"Back to applications":"View Trash"}</button>
      </JobActionMenu></div>
    <ApplicantCollections filter={filter} onApply={applyView} selectedIds={ids} selectionId={snapshotId || undefined} allMatching={isAll && ids.length>100} disabled={blocked} onChanged={()=>void reload()}/>
    <div className="aq-controls"><label className="aq-search">Search applicants<input type="search" value={search} placeholder="Name or email" maxLength={200} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Role or posting<select aria-label="Role or posting" value={jobId?"job:"+jobId:groupId?"group:"+groupId:""} onChange={e=>{
        const value=e.target.value;update({jobId:value.startsWith("job:")?value.slice(4):null,jobGroupId:value.startsWith("group:")?value.slice(6):null,grade:null,top:null});
      }}><option value="">All roles</option>{jobId&&!selectedJob&&<option value={"job:"+jobId}>Unavailable posting</option>}{!!groups.data?.groups?.length&&<optgroup label="Job groups">{groups.data.groups.map(g=><option value={"group:"+g.id} key={g.id}>{g.name}</option>)}</optgroup>}
      <optgroup label="Individual postings">{sortHubJobs(jobs).map(j=><option value={"job:"+j.id} key={j.id}>{j.title} · {jobLocation(j)}</option>)}</optgroup></select></label>
      <button type="button" className="hub-button secondary aq-filter-toggle" aria-expanded={showFilters} aria-controls="aq-filters" onClick={()=>setShowFilters(v=>!v)}>Filters &amp; order</button>
    </div>
    <div className="aq-filter-panel" id="aq-filters" data-open={showFilters}>
      <label>Stage<select aria-label="Stage" disabled={inTrash} value={stageChoice} onChange={e=>{const next=new URLSearchParams(filter);applyApplicantStageChoice(next,e.target.value);applyView(next.toString());}}>
        <option value="active">In progress</option><option value="all">All stages</option><option value="active:exclude:Screening">In progress — not shortlisted</option>
        {val("excludeStage")&&stageChoice!=="active:exclude:Screening"&&<option value={stageChoice}>Excluding {stageLabel(val("excludeStage"))}</option>}
        {stages.map(s=><option key={s} value={"stage:"+s}>{stageLabel(s)}</option>)}</select></label>
      <label>Screening<select aria-label="Screening" value={val("qualification")} onChange={e=>update({qualification:e.target.value})}><option value="">All screening results</option><option value="pass">Requirements met</option><option value="fail">Requirement not met</option><option value="review">No automatic decision</option></select></label>
      <label>Interview<select aria-label="Interview" value={val("interviewProgress")} onChange={e=>update({interviewProgress:e.target.value})}><option value="">Any interview status</option><optgroup label="Schedule">{Object.entries(INTERVIEW_VIEW_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</optgroup><optgroup label="Progress">{Object.entries(interviewProgressLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</optgroup></select></label>
      <label>Owner<select aria-label="Owner" value={val("assignee")} onChange={e=>update({assignee:e.target.value})}><option value="">All owners</option><option value="unassigned">Unassigned</option>{ownerChoices.map(email=><option key={email} value={email}>{email===reviewerEmail?"Me · ":""}{email}</option>)}</select></label>
      <label>Order<select aria-label="Order" value={val("sort")||defaultQueueSort} onChange={e=>update({sort:e.target.value})}>{Object.entries(sortLabels).filter(([k])=>(!!jobId||!roleSorts.includes(k))&&(k!=="list_order"||!!listId)).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <details className="aq-more"><summary>More filters</summary><div>
        <label>Country of residence<select aria-label="Country of residence" value={countryChoice} onChange={e=>{const code=e.target.value;setCountryChoice("");if(code)update({country:[...new Set([...countries,code])].join(",")});}}><option value="">Add a country</option>{countryOptions.map(c=><option key={c.value} value={c.value} disabled={countries.includes(c.value)}>{c.label}</option>)}</select></label>
        <label>Applied from<input type="date" value={val("appliedFrom")} max={val("appliedTo")||undefined} onChange={e=>update({appliedFrom:e.target.value})}/></label>
        <label>Applied through<input type="date" value={val("appliedTo")} min={val("appliedFrom")||undefined} onChange={e=>update({appliedTo:e.target.value})}/></label>
        {jobId&&<label>Reviewer grades<select aria-label="Reviewer grades" value={val("grade")} onChange={e=>update({grade:e.target.value})}><option value="">All grades</option><option value="reviewed">Graded</option><option value="ungraded">Ungraded</option></select></label>}
        <label className="hub-checkbox"><input type="checkbox" checked={val("duplicate")==="true"} onChange={e=>update({duplicate:e.target.checked?"true":null})}/>Shared-email applications</label>
        {jobId&&!inTrash&&<button type="button" className="hub-text-button" onClick={()=>update({sort:"ai_match_desc",top:"10"})}>Top 10 AI matches</button>}
      </div></details>
    </div>
    {chips.length>0&&<div className="aq-chips" aria-label="Applied filters">{chips.map(c=><button key={c.key} type="button" aria-label={"Remove filter: "+c.label} onClick={()=>update(c.changes)}>{c.label} <span aria-hidden="true">×</span></button>)}<button type="button" className="aq-clear" onClick={resetFilters}>Clear filters</button></div>}
    <Feedback error={error} success={notice}/>
    <ResourceState loading={loading&&!resource.error} error={resource.error} retry={()=>void reload()}/>
    {data&&<>
      {!!data.items.length&&<div className="aq-selection" aria-label="Application selection">
        {!selectMode&&!selection.length&&<button className="hub-text-button" type="button" onClick={()=>setSelectMode(true)}>Select applications</button>}
        {(selectMode||selection.length>0)&&<><span aria-live="polite">{selection.length?`${selection.length} selected${isAll?" · all matching":""}`: `${data.items.length} on this page`}</span>
        <button type="button" className="hub-text-button" disabled={blocked} onClick={()=>toggle(data.items)}>{data.items.every(r=>ids.includes(r.id))?"Deselect page":"Select page"}</button>
        <button type="button" className="hub-text-button" disabled={blocked||isAll} onClick={()=>void selectAll()}>Select all {total} matching</button>
        {!!selection.length&&<button type="button" className="hub-text-button" disabled={busy} onClick={clearSelection}>Clear selection</button>}{!selection.length&&<button type="button" className="hub-text-button" onClick={clearSelection}>Cancel</button>}</>}
      </div>}
      {selection.length>0&&!inTrash&&<div className="aq-bulk">
        <label>Apply to {selection.length} selected<select disabled={blocked} value={bulkAction} onChange={e=>setBulkAction(e.target.value)}><option value="">Choose action</option><option value="assign">Assign owner</option><option value="stage">Move stage</option><option value="reject">Preview rejection</option><option value="download">Download</option></select></label>
        {bulkAction==="assign"&&<label>New owner<select aria-label="New owner" value={bulkAssignee} onChange={e=>setBulkAssignee(e.target.value)}><option value="">Unassigned</option>{ownerChoices.map(email=><option key={email} value={email}>{email}</option>)}</select></label>}
        {bulkAction==="stage"&&<label>New stage<select aria-label="New stage" value={bulkStage} onChange={e=>setBulkStage(e.target.value)}>{stages.filter(s=>s!=="Rejected").map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}</select></label>}
        {["stage","assign"].includes(bulkAction)&&<button type="button" className="hub-button" disabled={blocked} onClick={()=>void applyBulk()}>{busy?"Updating…":"Update "+selection.length+" applications"}</button>}
        {bulkAction==="download"&&<button type="button" disabled={blocked} className="hub-button" onClick={()=>void download("zip")}>Download {selection.length} applications (ZIP)</button>}
        {bulkAction==="reject"&&<BulkRejection key={reviewerEmail+filter} actor={reviewerEmail} filter={filter} selectedIds={ids} selectionId={snapshotId} jobTitle={scopeName} disabled={blocked} changed={()=>{void reload();changed();}}/>}
      </div>}
      {(!selection.length || bulkAction!=="reject") && <BulkRejection key={"recovery"+reviewerEmail+filter} actor={reviewerEmail} recoveryOnly filter={filter} jobTitle={scopeName} disabled={blocked} changed={()=>{void reload();changed();}}/>}
      {data.items.length?<CandidateTable items={data.items} showRole={!selectedJob} roleInIdentity optionalColumns={columns} select={id=>open(id)} hrefFor={item=>applicantHref(item.id,new URLSearchParams({...Object.fromEntries(params),page:String(page)}).toString())}
        selected={ids} togglePage={()=>toggle(data.items)} toggle={id=>{const item=data.items.find(r=>r.id===id);if(item)toggle([item]);}}
        sort={val("sort")} onSort={order=>update({sort:order,top:null})} allowAiSort={!!jobId} busy={blocked}
        screeningConfigured={selectedJob?.rules?.some(rule=>rule.enabled)} shortlist={row=>void setApplicationStage(row,"Screening")} unshortlist={row=>void setApplicationStage(row,"Application Review")}/>
        :<EmptyState title="No applications in this view"><button className="hub-text-button" type="button" onClick={resetFilters}>Reset filters</button></EmptyState>}
      {total>0&&<div className="hub-pagination"><button type="button" className="hub-button secondary" disabled={page<=1||blocked} onClick={()=>turnPage(page-1)}>Previous</button>
        <span>Page {page} of {Math.max(1,Math.ceil(total/(data.pageSize||30)))} · {total} matching applicants</span>
        <button type="button" className="hub-button secondary" disabled={blocked||page*(data.pageSize||30)>=total} onClick={()=>turnPage(page+1)}>Next</button></div>}
    </>}
    {selectedJob&&<JobMatchSetup key={jobId} jobId={jobId} changed={()=>void reload()}/>}
  </section>;
}
export function CandidateDetail({
  id,
  back,
  backLabel = "Back to applications",
  changed,
  initialAction = "note",
  navigationFilter = "",
  navigationJobs = [],
  openApplicant,
  initialSection = "application",
  onDecisionNotice,
  reviewerEmail,
}: {
  id: string;
  back: () => void;
  backLabel?: string;
  changed: () => void;
  initialAction?: "note" | "interview";
  navigationFilter?: string;
  navigationJobs?: HubJob[];
  openApplicant?: (id:string,filter:string,section?:"application"|"review"|"activity")=>void;
  initialSection?: "application"|"review"|"activity";
  onDecisionNotice?: (message:string,next?:string|null)=>void;
  reviewerEmail?: string;
}) {
  const resource = useHubResource<ApplicationDetail>(
      "/api/hub/applications/" + encodeURIComponent(id),
    ),
    mutation = useHubMutation();
  const [evidenceRefresh,setEvidenceRefresh]=useState(0);
  const approval = useHubResource<InterviewHandoffReview>("/api/hub/applications/"+encodeURIComponent(id)+"/recruiter-review",evidenceRefresh);
  const [editingHandoff,setEditingHandoff]=useState(false);
  const [returningHandoff,setReturningHandoff]=useState(false);
  const [handoffQuestion,setHandoffQuestion]=useState("");
  const questionRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{ if(returningHandoff) questionRef.current?.focus(); },[returningHandoff]);
  const [reviewDirty,setReviewDirty]=useState(false);
  const [section, setSection] = useState<"application" | "review" | "activity">(initialSection);
  const aiMatchPanel = useRef<HTMLDetailsElement>(null);
  const [showHistoryReview,setShowHistoryReview] = useState(false);
  useEffect(()=>{
    if (!showHistoryReview || !aiMatchPanel.current) return;
    aiMatchPanel.current.open=true;
    aiMatchPanel.current.querySelector("summary")?.focus();
    setShowHistoryReview(false);
  },[section,showHistoryReview]);
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
    [attendance, setAttendance] = useState(""),
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
  const [interviewDraft,setInterviewDraft]=useState<InterviewDraftPayload|null>(null);
  const [interviewDirty,setInterviewDirty]=useState(false);
  const [confirmInterviewDiscard,setConfirmInterviewDiscard]=useState(false);
  const interviewLeave=useRef<(()=>void)|null>(null);
  const interviewOpenRef=useRef(false),interviewBusyRef=useRef(false);useLayoutEffect(()=>{interviewOpenRef.current=actionOpen&&action==="interview";interviewBusyRef.current=mutation.busy||decisionBusy},[actionOpen,action,mutation.busy,decisionBusy]);
  const [deleteOpen,setDeleteOpen] = useState(false);
  const [pdfBusy,setPdfBusy] = useState(false);
  const [pdfError,setPdfError] = useState("");
  const [leaveRequest,setLeaveRequest]=useState<(()=>void)|null>(null);
  const leaveDialog=useRef<HTMLDivElement>(null);
  const leaveOrigin=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{if(leaveRequest)leaveDialog.current?.focus();},[leaveRequest]);
  const evidenceDraft = useEvidenceDraft();
  const scorecardDraft = useScorecardDraft();
  const dirty = !!(interviewDirty || reviewDirty || handoffQuestion.trim() || evidenceDraft.notes.trim() || scorecardDraft[0].ratings.length || text.trim() || subject.trim() || body.trim() || reason.trim() || score || criteria.trim() || assignee.trim() || renew || emailPending || (actionOpen && ((action==="stage" && stage!=="Screening") || (action==="attendance" && attendance!==""))));
  const dirtyRef=useRef(dirty);useLayoutEffect(()=>{dirtyRef.current=dirty;},[dirty]);
  function resetInterview(){if(mutation.busy||decisionBusy)return;setConfirmInterviewDiscard(false);setActionOpen(false);setInterviewerEmail("");setRenew(false);setInterviewDraft(null);setInterviewDirty(false);setInterviewReady(false);mutation.clear();const leave=interviewLeave.current;interviewLeave.current=null;if(leave){dirtyRef.current=false;leave();}}
  function keepInterview(){interviewLeave.current=null;setConfirmInterviewDiscard(false);queueMicrotask(()=>actionPanel.current?.querySelector<HTMLElement>('select')?.focus({preventScroll:true}));}
  function cancelInterview(){const outcome=interviewCancelOutcome({busy:mutation.busy||decisionBusy,dirty:interviewDirty,confirming:confirmInterviewDiscard});if(outcome==="ask")setConfirmInterviewDiscard(true);else if(outcome==="keep")keepInterview();else if(outcome==="discard")resetInterview();}
  useEffect(()=>{
    const previous=window.__aiclDraftGuard;
    const guard=(leave:()=>void)=>{const outcome=interviewNavigationOutcome(interviewOpenRef.current,dirtyRef.current,interviewBusyRef.current);if(outcome==="blocked")return true;if(outcome==="leave")return previous?.(leave) || false;if(outcome==="modal"){interviewLeave.current=leave;setLeaveRequest(null);setConfirmInterviewDiscard(true);return true;}leaveOrigin.current=document.activeElement as HTMLElement;setLeaveRequest(()=>leave);return true;};
    window.__aiclDraftGuard=guard;
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",beforeUnload);
    return()=>{if(window.__aiclDraftGuard===guard)window.__aiclDraftGuard=previous;window.removeEventListener("beforeunload",beforeUnload);};
  },[]);
  const chooseSection=(next:typeof section)=>{const leave=()=>{setReviewDirty(false);setSection(next);};if(next!==section&&reviewDirty&&window.__aiclDraftGuard?.(leave))return;leave();};
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
    params.delete("page");
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
  async function decideHandoff(target:"Awaiting Founder Review"|"Second Round Interview"|"returnHandoff") {
    const detail=resource.data;
    if(!detail || mutation.busy || decisionBusy || (target!=="returnHandoff" && dirty))return;
    const params=reviewQueue(new URLSearchParams(navigationFilter));
    const inFounderQueue=params.get("stage")==="Awaiting Founder Review" && detail.stage==="Awaiting Founder Review";
    let next: {nextId:string|null} | undefined;
    if(inFounderQueue && openApplicant) {
      try { next=await hubRequest(`/api/hub/applications/${encodeURIComponent(id)}/navigation?${params}`); }
      catch { /* A decision is still valid if queue navigation is unavailable. */ }
    }
    const returning=target==="returnHandoff";
    const body=returning ? {action:"returnHandoff",reason:handoffQuestion.trim()} : {action:"stage",stage:target};
    const message=returning ? "Returned to the recruiter with your question." : target==="Awaiting Founder Review" ? "Sent for founder review." : "Moved to second-round interview.";
    const result=await mutation.run(`/api/hub/applications/${encodeURIComponent(id)}/action`,"POST",{...body,expectedRevision:detail.revision},message);
    if(result===undefined)return;
    setReturningHandoff(false);setHandoffQuestion("");dirtyRef.current=false;changed();
    if(next && openApplicant) {
      onDecisionNotice?.(message,next.nextId || "list");
      if(next.nextId)openApplicant(next.nextId,params.toString(),"review");else back();
    }else{ await Promise.all([resource.reload(),approval.reload()]); }
  }
  function openHandoffEditor(){
    chooseSection("review");setEditingHandoff(true);
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
    params.delete("page");
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
    if (action === "attendance" && (!canRecordAttendance || !attendance)) return;
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
                    ? {...interviewDraft}
                    : { text }),
    };
    if (action === "email" && !emailRequest.current) {
      emailRequest.current = { action: "email", subject, body, actionId: crypto.randomUUID(), expectedRevision: resource.data.revision };
      setEmailPending(true);
      setNewEmailApproved(false);
    }
    const payload = action === "email" ? emailRequest.current : draft;
    if(action==="interview")interviewBusyRef.current=true;
    const result = await mutation.run<{interviewDelivery?: {status:string;cc:string[]}}>(
      action==="interview"?"/api/interview-invitations":"/api/hub/applications/" + encodeURIComponent(id) + "/action",
      "POST",
      action==="interview"?{...payload,applicationId:id}:payload,
      ["reject", "assessment", "interview", "email"].includes(action)
        ? action==="interview"?(result)=>{
          const delivery=result.interviewDelivery;
          switch(delivery?.status) {
            case "sent": return {success:"Interview invitation sent." + (delivery.cc.length ? " CC: "+delivery.cc.join(", ")+".":"")};
            case "failed": return {error:"The invitation could not be sent. Check Activity for the delivery error."};
            case "uncertain": return {error:"Gmail has not confirmed this invitation. Check Activity before sending again."};
            case "cancelled": return {error:"The interview invitation was cancelled before sending."};
            default: return {success:"Invitation saved. Delivery is pending in Activity."};
          }
        }:"Decision saved. Delivery status appears in communication history."
        : "Saved to this application.",
    );
    if(action==="interview")interviewBusyRef.current=false;
    if (result !== undefined) {
      if (action === "attendance") setActionOpen(false);
      if(action==="interview"){interviewLeave.current=null;setConfirmInterviewDiscard(false);setInterviewReady(false);setInterviewDraft(null);setInterviewDirty(false);setActionOpen(false);}
      setText("");
      setApprove(false);
      setRenew(false);
      setScore(""); setCriteria(""); setReason(""); setAssignee(""); setInterviewerEmail(""); setStage("Screening"); setAttendance("");
      if (action === "email") { emailRequest.current = null; setEmailPending(false); setNewEmailApproved(false); setSubject(""); setBody(""); }
      await resource.reload();
      changed();
    }
  }
  const detail = resource.data;
  const canRecordAttendance = !!detail?.interview?.start &&
    (detail.interviewProgress === "booked" || detail.interviewProgress === "attendance_due") &&
    new Date(detail.interview.start).getTime() <= Date.now();
  return (
    <section ref={profileTop} className="hub-applicant-profile" aria-labelledby="candidate-title">
      {leaveRequest && <div className="hub-card" role="alertdialog" ref={leaveDialog} tabIndex={-1} aria-labelledby="leave-applicant-title"><h3 id="leave-applicant-title">Leave this applicant without saving?</h3><p>Your unsaved note or action will be discarded. Leaving does not send a new message. Check Activity for any email already pending.</p><div className="hub-button-row"><button type="button" className="hub-button" onClick={()=>{setLeaveRequest(null);leaveOrigin.current?.focus();}}>Keep editing</button><button type="button" className="hub-button secondary" onClick={()=>{const leave=leaveRequest;dirtyRef.current=false;setLeaveRequest(null);leave();}}>Discard changes and leave</button></div></div>}
      <div className="hub-profile-topbar">
        <button className="hub-text-button hub-back" disabled={decisionBusy} onClick={()=>requestDraftNavigation(back)}><ArrowLeft size={16}/> {backLabel}</button>
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
              <div className="hub-profile-name-row"><h2 id="candidate-title" tabIndex={-1}>{answerContactName(detail)}</h2><div className="hub-status-line"><ApplicantStageBadges application={detail}/><Badge tone={qualificationTone(detail.qualification)}>{qualificationLabel(detail.qualification,detail.qualificationEvidence.length>0)}</Badge></div></div>
              <p className="hub-profile-job">{detail.jobTitle}</p>
              {!!detail.relatedApplications?.length && <details key={detail.id}><summary>{detail.relatedApplications.length} other application{detail.relatedApplications.length===1?'':'s'} with this email{detail.relatedApplications.some(a=>a.differences.length)?' · Experience answers differ':''}</summary><ul>{detail.relatedApplications.map(a=><li key={a.id}><a href={applicantHref(a.id,"",a.jobId)}>{a.jobTitle}</a> · {displayDate(a.createdAt)} · {stageLabel(a.stage)}
                {a.differences.map(d=><p key={d.question}>{d.question} — This application: <strong>{d.current}</strong>; linked application: <strong>{d.other}</strong>.</p>)}</li>)}</ul></details>}
              <ClaimRadar detail={detail}/>
              {detail.interview?.start && (detail.interviewProgress === "booked" || detail.interviewProgress === "attendance_due") && <p className="hub-profile-contact">Interview · {displayDate(detail.interview.start, detail.interview.timeZone)} {detail.interview.timeZone}</p>}
              <p className="hub-profile-contact"><a href={"mailto:"+detail.email}>{detail.email}</a><span>Applied {displayDate(detail.createdAt)}</span><span>Assigned to {detail.assignee||"no recruiter"}</span></p>
            </div>
            <div className="hub-candidate-quick-actions" aria-label="Applicant actions">
              {!detail.trashed && detail.stage==="Application Review" && <button type="button" className="hub-button" disabled={mutation.busy||decisionBusy||dirty} title={dirty?"Save or clear unsaved changes first.":"Shortlist and open the next applicant. No email is sent."} onClick={()=>void shortlist()}>{shortlistBusy?"Shortlisting…":"Shortlist"}</button>}
              {!detail.trashed && detail.stage==="Screening" && <button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy||dirty} title={dirty?"Save or clear unsaved changes first.":"Return to initial review without sending an email."} onClick={()=>void unshortlist()}>Remove from shortlist</button>}
              {!detail.trashed&&!['Rejected','Withdrawn','Hired'].includes(detail.stage)&&<button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy||dirty} title={dirty?"Save or clear your unsaved note or action before rejecting.":"Reject and queue this job’s rejection email, then open the next active applicant."} onClick={()=>void rejectAndContinue()}>{rejectBusy?"Rejecting…":"Reject"}</button>}
              {detail.trashed && <button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy} onClick={()=>void lifecycle("restore")}>Restore application</button>}
              {!detail.trashed && canRecordAttendance && <button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy||dirty} onClick={()=>{setAction("attendance");setAttendance("");setActionOpen(true);mutation.clear();}}>Record attendance</button>}
              {!detail.trashed&&detail.stage==="Interview"&&(approval.data?.readiness?.ready
                ? <button type="button" className="hub-button" disabled={mutation.busy||decisionBusy||dirty} onClick={()=>void decideHandoff("Awaiting Founder Review")}>Send for founder review</button>
                : <button type="button" className="hub-button secondary" disabled={dirty||decisionBusy||mutation.busy} onClick={openHandoffEditor}>Complete interview handoff</button>)}
              {!detail.trashed&&detail.stage==="Awaiting Founder Review"&&approval.data?.canApprove&&<>
                <button type="button" className="hub-button" disabled={mutation.busy||decisionBusy||dirty} onClick={()=>void decideHandoff("Second Round Interview")}>Move to second-round interview</button>
                <button type="button" className="hub-button secondary" disabled={mutation.busy||decisionBusy||dirty} onClick={()=>{chooseSection("review");setReturningHandoff(true);}}>Return to recruiter</button>
              </>}
              {!detail.trashed&&<ShareApplicant key={detail.id} id={detail.id}/>}
              <JobActionMenu label="More applicant actions" triggerLabel="More">
                {!detail.trashed&&reviewerEmail&&detail.assignee!==reviewerEmail&&<button type="button" disabled={mutation.busy||decisionBusy} onClick={async()=>{const r=await mutation.run(`/api/hub/applications/${encodeURIComponent(id)}/action`,"POST",{action:"assign",assignee:reviewerEmail,expectedRevision:detail.revision},"Assigned to you.");if(r!==undefined){await resource.reload();changed()}}}><UserCheck size={16} aria-hidden="true"/>Assign to me</button>}
                {!detail.trashed && !["Rejected","Withdrawn","Hired"].includes(detail.stage) && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>{interviewLeave.current=null;setConfirmInterviewDiscard(false);setAction("interview");setActionOpen(true);mutation.clear();}}><CalendarClock size={16} aria-hidden="true"/>{detail.interview && isHistoricalInterview(detail.interview) ? "Request another interview" : "Request interview"}</button>}
                {!detail.trashed && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>{setAction("note");setActionOpen(true);mutation.clear();}}><StickyNote size={16} aria-hidden="true"/>Add note</button>}
                {!detail.trashed && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>{setAction("stage");setActionOpen(true);mutation.clear();}}><Settings2 size={16} aria-hidden="true"/>Other applicant actions</button>}
                <button type="button" disabled={pdfBusy} onClick={()=>void exportPdf()}><Download size={16}/>{pdfBusy?"Preparing PDF…":"Download application PDF"}</button>
                <button type="button" disabled={decisionBusy} onClick={()=>void resource.reload()}><RefreshCw size={16} aria-hidden="true"/>Refresh application</button>
                {!detail.trashed && <button type="button" disabled={mutation.busy||decisionBusy} onClick={()=>setDeleteOpen(true)}><Trash2 size={16} aria-hidden="true"/>Delete application</button>}
              </JobActionMenu>
            </div>
          </header>
          <Feedback error={mutation.error||pdfError} success={mutation.success}/>
          {!detail.trashed&&detail.stage==="Interview"&&approval.data?.returned&&section!=="review"&&<p className="hub-notice hub-handoff-question"><strong>More information requested</strong><br/>{approval.data.returned.question}</p>}
          {!detail.trashed&&detail.stage==="Awaiting Founder Review"&&section!=="review"&&<button type="button" className="hub-text-button" onClick={()=>chooseSection("review")}>Open interview handoff{detail.notesReview?.hasUnread?" · unread notes":""}</button>}
          {detail.trashed && <p className="hub-muted">This application is in Trash. Its files and history are retained. Restore it before taking recruiting actions.</p>}
          {deleteOpen && <div className="hub-card" role="alertdialog" aria-labelledby="delete-application-title"><h3 id="delete-application-title">Move this application to Trash?</h3><p>It will leave your recruiting queues. Files and history stay saved, and you can restore it from this job’s Trash tab. Unsent emails and active booking links will be cancelled.</p><div className="hub-button-row"><button className="hub-button secondary" type="button" disabled={mutation.busy||decisionBusy} onClick={()=>setDeleteOpen(false)}>Keep application</button><button className="hub-button" type="button" disabled={mutation.busy||decisionBusy} onClick={()=>void lifecycle("trash")}>Move to Trash</button></div></div>}
          <div className="hub-detail-grid">
            {!detail.trashed && actionOpen && <InterviewActionFrame interview={action==="interview"} panelRef={actionPanel} cancel={cancelInterview} busy={mutation.busy||decisionBusy}>
              <ApplicantActionCard interview={action==="interview"} open={actionOpen} toggle={open=>{setActionOpen(open);if(!open)profileTop.current?.querySelector<HTMLElement>('summary[aria-label="More applicant actions"]')?.focus({preventScroll:true});}}>
              {action==="interview"?<h3 id="hub-invitation-title">Invite to interview</h3>:<summary>Applicant actions</summary>}
              <p className="hub-muted">{action==="interview"?"Choose the interviewer and send the applicant a booking link.":"Choose an action for this application."}</p>
              {action==="interview"&&confirmInterviewDiscard&&<InterviewDiscardConfirmation busy={mutation.busy||decisionBusy} keep={keepInterview} discard={resetInterview}/>}
              <form onSubmit={submit}>
                <fieldset disabled={mutation.busy||decisionBusy||detail.trashed||confirmInterviewDiscard}>
                  {action!=="interview"&&<Field label="Action">
                    <select
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value);
                        if(e.target.value === "scorecard") setSection("review");
                        setText("");
                        setApprove(false);
                        setAttendance("");
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
                      {canRecordAttendance && <option value="attendance">Record interview attendance</option>}
                      <option value="email">Send email</option>
                      <option value="reject">Reject application</option>
                    </select>
                  </Field>}
                  {(action==="assessment"||action==="interview"&&!!detail.interview&&!isHistoricalInterview(detail.interview)) && <label className="hub-checkbox"><input type="checkbox" checked={renew} onChange={(e) => {setRenew(e.target.checked);if(action==="interview")setInterviewDirty(true);}} /> Send a replacement secure link and revoke the previous link. Existing responses and bookings remain in history.</label>}
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
                    <InterviewComposer applicationId={id} jobId={detail.jobId} name={detail.name} jobTitle={detail.jobTitle} email={detail.email} value={interviewerEmail} change={setInterviewerEmail} renew={renew} reviewerEmail={reviewerEmail} sendErrorCode={mutation.errorCode} ready={setInterviewReady} draft={setInterviewDraft} dirty={setInterviewDirty} cancel={cancelInterview}/>
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
                        <option value="">Choose attendance</option>
                        <option value="true">Attended</option>
                        <option value="false">No-show</option>
                      </select>
                    </Field>
                  )}
                  {action==="interview"&&!["template_changed","preview_changed"].includes(mutation.errorCode)&&<Feedback error={mutation.error}/>}
                  <div className="hub-button-row hub-action-submit"><button
                    className={
                      "hub-button " + (action === "reject" ? "danger" : "")
                    }
                    type="submit"
                    disabled={mutation.busy || (action === "reject" && !approve) || (action === "interview" && !interviewReady) || (action === "attendance" && (!attendance || !canRecordAttendance))}
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
                              : action === "attendance" ? "Save attendance" : "Save action"}
                  </button>{action==="interview"&&<button type="button" className="hub-button secondary" disabled={mutation.busy} onClick={cancelInterview}>Cancel invitation</button>}</div>
                </fieldset>
              </form>
              </ApplicantActionCard>
            </InterviewActionFrame>}
            <div className="hub-detail-main">
              <div ref={recordTabs} className="hub-button-row hub-profile-tabs" role="tablist" aria-label="Applicant record">{([{id:"application",label:"Application & files"},{id:"review",label:"Interviews & notes"},{id:"activity",label:"Activity & messages"}] as const).map(tab=><button key={tab.id} type="button" role="tab" id={`candidate-tab-${tab.id}`} aria-selected={section===tab.id} tabIndex={section===tab.id?0:-1} onKeyDown={event=>{const ids=["application","review","activity"] as const;const index=ids.indexOf(section);const next=event.key==="ArrowRight"?ids[(index+1)%3]:event.key==="ArrowLeft"?ids[(index+2)%3]:event.key==="Home"?ids[0]:event.key==="End"?ids[2]:null;if(next){event.preventDefault();chooseSection(next);document.getElementById(`candidate-tab-${next}`)?.focus({preventScroll:true});}}} aria-controls={`candidate-panel-${tab.id}`} className={"hub-button " + (section===tab.id ? "" : "secondary")} onClick={()=>chooseSection(tab.id)}>{tab.label}</button>)}</div>
              <div role="tabpanel" id="candidate-panel-review" aria-labelledby="candidate-tab-review" hidden={section!=="review"}>
              <fieldset disabled={decisionBusy} style={{border:0,padding:0,margin:0,minWidth:0}}>
              {section === "review" && <><WorkflowReview id={detail.id} resource={approval} editing={editingHandoff} onEdit={setEditingHandoff} onDirty={setReviewDirty} changed={()=>{void resource.reload();changed();}}/>
              {returningHandoff && detail.stage==="Awaiting Founder Review" && <form className="hub-card hub-return-question" onSubmit={event=>{event.preventDefault();void decideHandoff("returnHandoff");}}>
                <label>What should the recruiter clarify?<textarea ref={questionRef} required maxLength={2000} rows={3} value={handoffQuestion} onChange={event=>setHandoffQuestion(event.target.value)}/></label>
                <div className="hub-button-row"><button type="submit" className="hub-button" disabled={!handoffQuestion.trim()||mutation.busy}>Send question to recruiter</button><button type="button" className="hub-text-button" disabled={mutation.busy} onClick={()=>{setReturningHandoff(false);setHandoffQuestion("");}}>Cancel</button></div>
                <Feedback error={mutation.error} success=""/>
              </form>}{reviewDirty?<p className="hub-muted">Save your interview handoff before attaching a recording.</p>:<RecordingPanel applicationId={detail.id} primaryRecordingInHandoff refresh={evidenceRefresh} changed={()=>{setEvidenceRefresh(n=>n+1);void resource.reload();changed();}}/>}</>}
              <RecruiterNotes detail={detail} busy={mutation.busy||decisionBusy||dirty} addNote={()=>{setAction("note");setActionOpen(true);}} changed={()=>{void resource.reload();changed();}}/>
              {section==="review"&&<details className="hub-card" ref={aiMatchPanel}><summary>AI job match</summary><CandidateMatch applicationId={detail.id}/></details>}
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
              </fieldset>
              </div>
              <div role="tabpanel" id="candidate-panel-application" aria-labelledby="candidate-tab-application" hidden={section!=="application"}>
              <section className="hub-card">
                <h3>Application answers</h3>
                <ApplicationAnswers detail={detail}/>
                {!detail.trashed && <ResponseCheckPanel key={detail.id} applicationId={detail.id}/>}
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
              <ApplicantMessages detail={detail} busy={mutation.busy||decisionBusy||dirty} compose={()=>{setAction("email");setActionOpen(true);mutation.clear();}}/>
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
                    <Badge>{interview.interviewProgress ? interviewProgressLabels[interview.interviewProgress] : interview.status}</Badge>
                  </div>
                  <p>
                    {interview.start?displayDate(interview.start, interview.timeZone):"No interview time selected yet"}
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
                  {index === 0 && interview.linkActive && interview.hasSentBookingLink && (
                    <a className="hub-text-button" target="_blank" rel="noopener noreferrer"
                      href={`/api/interview-sent-link?applicationId=${encodeURIComponent(detail.id)}&interviewId=${encodeURIComponent(interview.id)}`}>Open sent booking link <ExternalLink size={14}/></a>
                  )}
                  {interview.linkExpiresAt && <p className="hub-muted">Secure link {interview.linkActive ? "active" : "unavailable"} · expires {displayDate(interview.linkExpiresAt)}. {isHistoricalInterview(interview) ? "This interview is in history." : "Use Request interview to manage the link."}</p>}
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
                    No scorecards yet. Use Interviews &amp; notes to record a review.
                  </p>
                )}
              </section>
              <p className="hub-muted">Human feedback is kept in one place. <button type="button" className="hub-text-button" onClick={()=>chooseSection("review")}>Open recruiter notes{detail.notesReview?.hasUnread?" · unreviewed notes":""}</button></p>
              <section className="hub-card">
                <h3>Hiring history</h3>
                {detail.history.length ? (
                  <ol className="hub-history-list">
                    {detail.history.map((event) => {const summary=activitySummary(event);return (
                      <li key={event.id}>
                        <strong>{summary.title}</strong>
                        {summary.description && (event.type==="note" || summary.description.length>240 ? <details><summary>View details</summary><p className="hub-preserve">{summary.description}</p></details> : <p>{summary.description}</p>)}
                        {summary.review && <button type="button" className="hub-text-button" onClick={()=>{setSection("review");setShowHistoryReview(true);}}>View AI review</button>}
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
