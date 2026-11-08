"use client";
import { GlobalSearch } from "./global-search";
import { SessionBoundary } from "./session-boundary";
import { ListReviewInbox } from "./list-review-inbox";
import { WorkflowHome } from "./workflow-home";
import { InterviewWorkspace } from "./interview-workspace";
import { NavigationLink, applicantHref } from "./navigation-link";
import { requestDraftNavigation } from "./draft-navigation";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Brand } from "@/components/careers/chrome";
import { useHubResource, displayDate } from "./api";
import { sortHubJobs } from "./job-order";
import { normalizeApplicantScope } from "./applicant-stage-filter";
import { CandidateDetail, Candidates } from "./candidates";
import { Jobs } from "./jobs";
import { Reports } from "./reports";
import { HubSettings, Tasks, type SettingsSection } from "./settings";
import { ReviewReminderQueue } from "./review-reminders";
import { Badge, EmptyState, ResourceState } from "./shared";
import { stageLabel, stages, type Member, type Overview } from "./types";

type View =
  "overview" | "applications" | "interviews" | "jobs" | "reports" | "tasks" | "settings";
const applicantFilters = ["q", "jobId", "jobGroupId", "country", "listId", "columns", "stage", "excludeStage", "interviewProgress", "handoffReturned", "assignee", "qualification", "grade", "sort", "top", "active", "duplicate", "trash", "appliedFrom", "appliedTo", "timeZone"] as const;
const navigation = [
  { id: "overview", label: "Home", icon: LayoutDashboard },
  { id: "applications", label: "Applicants", icon: ClipboardList },
  { id: "interviews", label: "Interviews", icon: CalendarDays },
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
export function HiringDashboard({
  member,
  signOutHref,
}: {
  member: Member;
  signOutHref: string;
}) {
  const [view, setView] = useState<View>("overview"),
    [refresh, setRefresh] = useState(0),
    [detailId, setDetailId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [candidateSection,setCandidateSection]=useState<"application"|"review"|"activity">("application");
  const [candidateAction, setCandidateAction] = useState<"note" | "interview">("note");
  const menuButton = useRef<HTMLButtonElement>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  useEffect(()=>{if(!workspaceNotice.startsWith("Sign-in restored."))return;const timeout=window.setTimeout(()=>setWorkspaceNotice(""),8000);return()=>window.clearTimeout(timeout)},[workspaceNotice]);
  const [decisionNotice,setDecisionNotice]=useState("");
  const [decisionSequence,setDecisionSequence]=useState(0);
  const decisionContext=useRef<{href:string;next:string|null}|null>(null);
  function dismissDecision(){decisionContext.current=null;setDecisionNotice("");}
  function showDecision(message:string,next:string|null=null){decisionContext.current={href:window.location.href,next};setDecisionNotice(message);setDecisionSequence(value=>value+1);}
  useEffect(()=>{if(!decisionNotice)return;const timer=window.setTimeout(dismissDecision,8000);return()=>window.clearTimeout(timer);},[decisionNotice,decisionSequence]);
  const [createJob, setCreateJob] = useState(0);
  const [initialStage, setInitialStage] = useState("");
  const [interviewView, setInterviewView] = useState("upcoming");
  const [initialJobId, setInitialJobId] = useState("");
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  function readLocation() {
    setMenuOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "applications" && params.has("interviewProgress")) {
      const original = params.toString();
      normalizeApplicantScope(params);
      if (params.toString() !== original) {
        const canonical = new URL(window.location.href);
        canonical.search = params.toString();
        window.history.replaceState(window.history.state, "", canonical);
      }
    }
    const decision=decisionContext.current;
    if(decision&&decision.href!==window.location.href){
      const destination=params.get("application")||"list";
      if(decision.next===destination&&params.get("view")==="applications"){decisionContext.current={href:window.location.href,next:null};}
      else dismissDecision();
    }
    if(params.get("personalMail"))queueMicrotask(()=>setWorkspaceNotice(params.get("personalMail")==="connected"?"Your recruiting email account is connected. Confirm your sender setup and test delivery before using it.":"Your recruiting email was not connected. Choose your signed-in account and approve all requested permissions, then try again."));
    const requested = params.get("view");
    const allowed = ["home", "overview", "applications", "interviews", "jobs", "reports", "tasks", "settings"];
    const next = requested && allowed.includes(requested) ? (requested === "home" ? "overview" : requested as View) : params.has("application") ? "applications" : "overview";
    setView(next);
    setDetailId(params.get("application"));
    const requestedSection=params.get("candidateSection");
    setCandidateSection(requestedSection==="review" || requestedSection==="activity" ? requestedSection : "application");
    setCandidateAction(params.get("candidateAction") === "interview" ? "interview" : "note");
    setInitialStage(next === "applications" && stages.includes(params.get("stage") || "") ? params.get("stage")! : "");
    setInitialJobId(next === "applications" || next === "interviews" ? params.get("jobId") || "" : "");
    setInterviewView(params.get("interviewProgress") ?? "upcoming");
    const filters = new URLSearchParams();
    for (const key of applicantFilters) if (next === "applications" && params.has(key)) filters.set(key, params.get(key)!);
    setInitialFilter(filters.toString());
    const page = Number(params.get("page"));
    setInitialPage(Number.isFinite(page) ? Math.max(1, Math.min(10000, Math.floor(page))) : 1);
    const settingsTarget=params.get("section");setSettingsSection(next === "settings" && ["personal","templates","team","integrations","diagnostics","scorecards","help"].includes(settingsTarget||"") ? settingsTarget as SettingsSection : settingsTarget === "company" ? "integrations" : undefined);
    setCreateJob(0);
  }
  const [initialFilter, setInitialFilter] = useState("");
  const [initialPage, setInitialPage] = useState(1);
  useEffect(() => {
    const ownedPath = window.location.pathname;
    // Mark the entry that loaded the workspace, including direct applicant links.
    window.history.replaceState({...window.history.state, aiclHub:true}, "", window.location.href);
    queueMicrotask(readLocation);
    const pop = (event: PopStateEvent) => {
      if (event.state?.aiclHub && window.location.pathname === ownedPath) {
        // These entries change dashboard state only. Letting the framework fetch
        // an RSC page for each query change makes rapid Back/Forward abort a render.
        event.stopImmediatePropagation();
        readLocation();
        window.dispatchEvent(new Event("hub:navigate"));
      } else readLocation();
    };
    window.addEventListener("popstate", pop, true);
    // The pre-hydration guard owns real /team history traversal. The popstate
    // listener remains a fallback for isolated renders without the server shell.
    window.addEventListener("hub:navigate", readLocation);
    const params = new URLSearchParams(window.location.search), outcome = params.get("workspace"), personalOutcome = params.get("personalCalendar");
    if (personalOutcome) queueMicrotask(() => {
      setWorkspaceNotice(personalOutcome === "connected" ? "Your calendar is connected. Confirm your interview hours in My connections, then complete a test booking." : "Your calendar authorization did not complete. Connect again in My connections using your own dashboard account and approve Calendar access.");
    });
    if (outcome) queueMicrotask(() => {
      if (outcome === "connection_failed") {
        const messages: Record<string, string> = {
          wrong_sender: "Google authorization used a different account. Connect again using the recruiting account shown in Google connection setup.",
          missing_permissions: "Google authorization did not include all required Gmail, Calendar, and Drive permissions. Connect again and approve the requested access.",
          configuration_changed: "The Google client configuration changed during authorization. Connect Google Workspace again using the current client settings.",
          offline_grant_missing: "Google did not provide the background authorization required for recruiting tasks. Reconnect the recruiting account and approve access again.",
        };
        setWorkspaceNotice(messages[params.get("reason") || ""] || "Google authorization did not complete. Review your OAuth setup and try connecting again in Settings.");
      }
      if (outcome === "connected") setWorkspaceNotice("Google authorization completed. Confirm the recruiting sender, Calendar availability, and Drive folder in Settings before testing a delivery.");
      if (member.role === "admin") {
        const url = new URL(window.location.href); url.searchParams.set("view", "settings");
        window.history.replaceState(window.history.state, "", url); readLocation();
      }
    });
    return () => {
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("hub:navigate", readLocation);
    };
    // Location, rather than a captured React view, is the source of navigation state.
  }, [member.role]);
  const resource = useHubResource<Overview>("/api/hub/overview", refresh);
  const admin = member.role === "admin",
    data = resource.data;
  function changed() {
    setRefresh((value) => value + 1);
  }
  function navigate(url: URL, replace = false, candidateFrom?: string) {
    requestDraftNavigation(() => {
      if (url.href !== window.location.href) {
        const state = { aiclHub: true, ...(candidateFrom ? { candidateFrom } : {}) };
        window.history[replace ? "replaceState" : "pushState"](state, "", url);
      }
      readLocation();
      window.dispatchEvent(new Event("hub:navigate"));
    }, url.href);
  }
  function viewUrl(next: View) {
    const url = new URL(window.location.href);
    for (const key of [...applicantFilters, "application", "candidateAction", "candidateSection", "workspace", "reason", "page", "section", "jobEditor", "jobStep", "jobStart", "jobSource", "jobSession"]) url.searchParams.delete(key);
    url.searchParams.set("view", next === "overview" ? "home" : next);
    return url;
  }
  function changeView(next: View) { navigate(viewUrl(next)); }
  function openStage(stage: string) { const url = viewUrl("applications"); url.searchParams.set("stage", stage); navigate(url); }
  function openJobApplicants(jobId: string) { const url = viewUrl("applications"); url.searchParams.set("jobId", jobId); navigate(url); }
  function beginJob() { changeView("jobs"); setCreateJob(Date.now()); }
  function selectApplication(id: string, action?: "interview", filter?: string, section?:"application"|"review"|"activity") {
    const url = new URL(window.location.href); url.searchParams.set("application", id);
    if(section)url.searchParams.set("candidateSection",section);else url.searchParams.delete("candidateSection");
    if(filter!==undefined){
      const listPage=url.searchParams.get("view")==="applications"?url.searchParams.get("page"):null;
      for(const key of [...applicantFilters,"page"])url.searchParams.delete(key);
      url.searchParams.set("view","applications");
      new URLSearchParams(filter).forEach((value,key)=>url.searchParams.set(key,value));
      if(listPage&&!url.searchParams.has("page"))url.searchParams.set("page",listPage);
    }
    if(!section && !action && (url.searchParams.get("stage")==="Awaiting Founder Review" || url.searchParams.get("handoffReturned")==="true")) url.searchParams.set("candidateSection","review");
    if(action) url.searchParams.set("candidateAction",action); else url.searchParams.delete("candidateAction");
    navigate(url, false, window.location.href);
  }
  function closeApplication() {
    const url = new URL(window.location.href); url.searchParams.delete("application"); url.searchParams.delete("candidateAction"); url.searchParams.delete("candidateSection");
    // Only traverse a predecessor that this dashboard created. A direct link stays here.
    if (window.history.state?.aiclHub && window.history.state?.candidateFrom === url.href) window.history.back();
    else {if (!url.searchParams.has("view")) url.searchParams.set("view", "applications"); navigate(url, true);}
  }
  function applyFilters(filter: string, page: number, replace = false) {
    const url = viewUrl("applications");
    new URLSearchParams(filter).forEach((value, key) => url.searchParams.set(key, value));
    if (page > 1) url.searchParams.set("page", String(page));
    navigate(url, replace);
  }
  function selectInterviewView(role: string, progress: string, page: number) {
    const url = viewUrl("interviews");
    if (role) url.searchParams.set("jobId", role);
    // An empty status represents the explicit All interviews view.
    if (progress !== "upcoming") url.searchParams.set("interviewProgress", progress);
    if (page > 1) url.searchParams.set("page", String(page));
    navigate(url);
  }
  function manageScorecards() { const url = viewUrl("settings"); url.searchParams.set("section", "scorecards"); navigate(url); }
  return (
    <div className="hiring-hub" data-hiring-workspace>
      <SessionBoundary email={member.email} onRestored={()=>setWorkspaceNotice("Sign-in restored. Your unsent entries are unchanged. Save or discard them before refreshing the workspace.")}/>
      <a href="#hub-main" className="skip-link">
        Skip to hiring workspace
      </a>
      <aside className={"hub-sidebar" + (menuOpen ? " menu-open" : "")} onKeyDown={event => {
        if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
      }}>
        <div className="hub-sidebar-heading">
          <Brand />
          <button ref={menuButton} type="button" className="hub-menu-toggle" aria-expanded={menuOpen} aria-controls="hub-navigation" aria-label={menuOpen ? "Close workspace menu" : "Open workspace menu"} onClick={() => setMenuOpen(open => !open)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />} Menu
          </button>
        </div>
        <div id="hub-navigation" className="hub-navigation">
        <div className="hub-workspace-label">HIRING WORKSPACE</div>
        <nav aria-label="Hiring workspace">
          {navigation
            
            .map((item) => (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                aria-current={
                  view === item.id ? "page" : undefined
                }
                onClick={() => {
                  changeView(item.id);
                  if (menuButton.current?.offsetParent) menuButton.current.focus();
                }}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
        </nav>
        <div className="hub-sidebar-bottom">
          <a href="/" target="_blank" rel="noopener noreferrer">
            Applicant website <ExternalLink size={15} />
          </a>
          <p>{member.email}</p>
          <Badge>{member.isOwner ? "Owner" : admin ? "Head recruiter" : "Recruiter"}</Badge>
          <a href={signOutHref}>
            <LogOut size={15} /> Sign out
          </a>
        </div>
        </div>
      </aside>
      <div className="hub-workspace">
        <header className="hub-topbar">
          <span className="hub-breadcrumb"><strong>Hiring workspace</strong><span aria-hidden="true">/</span>{detailId ? "Applicant profile" : navigation.find(item => item.id === view)?.label || "Delivery activity"}</span>
          <div>
            <GlobalSearch onNavigate={href=>navigate(new URL(href,window.location.origin))}/>
            <Badge
              tone={
                data?.integrations.applicationsEnabled ? "success" : "warning"
              }
            >
              {data
                ? data.integrations.applicationsEnabled
                  ? "Applications open"
                  : "Applications closed"
                : "Checking setup"}
            </Badge>
            <button
              className="hub-icon-button"
              onClick={changed}
              aria-label="Refresh hiring workspace"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main id="hub-main" className="hub-main">
          {workspaceNotice && <p className="hub-notice" role="status">{workspaceNotice}</p>}
          {decisionNotice && <div className="hub-notice" style={{display:"flex",alignItems:"center",gap:12,justifyContent:"space-between"}}><p role="status" style={{margin:0}}>{decisionNotice}</p><button type="button" className="hub-text-button" aria-label="Dismiss decision notification" onClick={dismissDecision}>Dismiss</button></div>}
          {view === "applications" && <div hidden={!!detailId}><Candidates
            key={data?.jobs.some(job => job.id === initialJobId) ? initialJobId : "job-index"}
            initialStage={initialStage}
            initialJobId={initialJobId}
            initialFilter={initialFilter}
            initialPage={initialPage}
            reviewerEmail={member.email}
            jobs={data?.jobs || []}
            refresh={refresh}
            changed={changed}
            onSelect={selectApplication}
            onFilterChange={applyFilters}
          /></div>}
          {detailId ? (
            <CandidateDetail
              key={`${detailId}:${candidateAction}`}
              id={detailId}
              reviewerEmail={member.email}
              initialAction={candidateAction}
              initialSection={candidateSection}
              onDecisionNotice={showDecision}
              navigationFilter={initialFilter}
              navigationJobs={data?.jobs || []}
              openApplicant={(id,filter,section)=>selectApplication(id,undefined,filter,section)}
              back={closeApplication}
              backLabel={view === "interviews" ? "Back to interviews" : undefined}
              changed={changed}
            />
          ) : view === "overview" ? (
            <>
              <div className="hub-section-heading">
                <div><h1>Your hiring workspace</h1><p>Review applicants, complete interviews and make the next decision.</p></div>
                <button className="hub-button" onClick={beginJob}>Create job</button>
              </div>
              <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
              {data && !resource.loading && <>
                <WorkflowHome refresh={refresh} reviewerEmail={member.email} openQueue={(filter)=>applyFilters(filter,1)} open={(id,filter,section)=>selectApplication(id,undefined,filter,section)} />
                <ListReviewInbox onOpenApplication={(id,listId)=>selectApplication(id,undefined,new URLSearchParams({listId,active:"false",sort:"list_order"}).toString(),"review")} />
                <details className="hub-overview-details"><summary>Hiring overview &amp; connections</summary>
                <div className="hub-overview-metrics" aria-label="Hiring snapshot">
                  {[{stage:"Application Review",label:"In initial review"},{stage:"Screening",label:"Shortlisted"},{stage:"Interview",label:"Interviews"}].map(item => <button className="hub-overview-metric" key={item.stage} onClick={() => openStage(item.stage)}><span>{item.label}</span><strong>{(data.stageCounts.find(stage => stage.stage === item.stage)?.count || 0).toLocaleString()}</strong><small>Across all jobs · view applicants</small></button>)}
                  <button className="hub-overview-metric" onClick={() => changeView("jobs")}><span>Open jobs</span><strong>{data.jobs.filter(job => job.status === "open" && (!job.lifecycle || job.lifecycle.state === "active")).length}</strong><small>Manage jobs</small></button>
                </div>
                <section className="hub-card hub-overview-jobs">
                  <div className="hub-section-heading compact"><h2>Open jobs</h2><button className="hub-text-button" onClick={() => changeView("jobs")}>Manage jobs</button></div>
                  {data.jobs.some(job => job.status === "open" && (!job.lifecycle || job.lifecycle.state === "active")) ? <ul className="hub-home-job-list">{sortHubJobs(data.jobs).filter(job => job.status === "open" && (!job.lifecycle || job.lifecycle.state === "active")).slice(0, 6).map(job => <li key={job.id}><div><NavigationLink className="hub-object-link" href={"/team?view=applications&jobId="+encodeURIComponent(job.id)} navigate={() => openJobApplicants(job.id)}>{job.title}</NavigationLink><p className="hub-muted">{job.location || "Location not set"}</p></div><Badge tone={job.status === "open" ? "success" : "neutral"}>{job.status === "open" ? "Published" : "Draft"}</Badge><NavigationLink className="hub-button secondary" href={"/team?view=applications&jobId="+encodeURIComponent(job.id)} navigate={() => openJobApplicants(job.id)}>View applicants</NavigationLink></li>)}</ul> : <EmptyState title="No open jobs"><p>Publish a draft or resume a paused job from Jobs, or create a new posting.</p><button className="hub-button" onClick={beginJob}>Create job</button></EmptyState>}
                </section>
                <div className="hub-overview-columns">
                  <section className="hub-card">
                    <div className="hub-section-heading compact"><h2>Latest applicants</h2><button className="hub-text-button" onClick={() => changeView("applications")}>All applicants</button></div>
                    {data.recentApplications.length ? <ul className="hub-activity-list">{data.recentApplications.slice(0,5).map(application => <li key={application.id}><NavigationLink className="hub-object-link" href={applicantHref(application.id,"",application.jobId)} navigate={() => selectApplication(application.id)}>{application.name}</NavigationLink><p>{application.jobTitle}</p><span className="hub-muted">{stageLabel(application.stage)} · Applied {displayDate(application.createdAt)}</span></li>)}</ul> : <p className="hub-muted">Applications will appear here once a published job receives them.</p>}
                  </section>
                  <ReviewReminderQueue refresh={refresh} onSelect={selectApplication} compact />
                </div>
                <div className="hub-home-status" aria-label="Hiring connections"><span className="hub-muted">{data.integrations.google && data.integrations.drive && data.integrations.applicationsEnabled ? "Company connections ready" : "Company needs attention"}</span><button className="hub-text-button" onClick={() => changeView("settings")}>Connections &amp; team</button><button className="hub-text-button" onClick={() => changeView("tasks")}>Delivery activity</button></div></details>
              </>}
            </>
          ) : view === "applications" ? null : view === "jobs" ? (
            <Jobs admin={true} refresh={refresh} changed={changed} startCreating={!!createJob} onManageScorecards={manageScorecards} />
          ) : view === "interviews" ? (
            <InterviewWorkspace role={initialJobId} progress={interviewView} page={initialPage} select={selectInterviewView} refresh={refresh} jobs={data?.jobs || []} openApplicant={(id:string)=>selectApplication(id,undefined,undefined,"review")} />
          ) : view === "reports" ? (
            <Reports refresh={refresh} />
          ) : view === "tasks" ? (
            <Tasks admin={admin} refresh={refresh} changed={changed} />
          ) : (
            <HubSettings member={member} refresh={refresh} changed={changed} jobs={data?.jobs || []} startSection={settingsSection} onDeliveryActivity={() => changeView("tasks")} />
          )}

        </main>
      </div>
    </div>
  );
}
