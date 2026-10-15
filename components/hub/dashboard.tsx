"use client";
import {RecruitingRequests} from "./recruiting-help";
import { requestDraftNavigation } from "./draft-navigation";
import { useEffect, useRef, useState } from "react";
import {
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
import { useHubResource } from "./api";
import { CandidateDetail, CandidateTable, Candidates } from "./candidates";
import { Jobs } from "./jobs";
import { Reports } from "./reports";
import { HubSettings, Tasks } from "./settings";
import { ReviewReminderQueue } from "./review-reminders";
import { Badge, EmptyState, ResourceState } from "./shared";
import { stages, type Member, type Overview } from "./types";

type View =
  "overview" | "applications" | "jobs" | "reports" | "tasks" | "settings";
const navigation = [
  { id: "overview", label: "Home", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: ClipboardList },
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [createJob, setCreateJob] = useState(0);
  const [initialStage, setInitialStage] = useState("");
  const [initialJobId, setInitialJobId] = useState("");
  const [settingsSection, setSettingsSection] = useState<"scorecards" | undefined>();
  function readLocation() {
    setMenuOpen(false);
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    const allowed = ["home", "overview", "applications", "jobs", "reports", "tasks", "settings"];
    const next = requested && allowed.includes(requested) ? (requested === "home" ? "overview" : requested as View) : params.has("application") ? "applications" : "overview";
    setView(next);
    setDetailId(params.get("application"));
    setInitialStage(next === "applications" && stages.includes(params.get("stage") || "") ? params.get("stage")! : "");
    setInitialJobId(next === "applications" ? params.get("jobId") || "" : "");
    const filters = new URLSearchParams();
    for (const key of ["q", "jobId", "stage", "assignee", "qualification", "grade", "sort", "top", "duplicate"]) if (next === "applications" && params.has(key)) filters.set(key, params.get(key)!);
    setInitialFilter(filters.toString());
    const page = Number(params.get("page"));
    setInitialPage(Number.isFinite(page) ? Math.max(1, Math.min(10000, Math.floor(page))) : 1);
    setSettingsSection(next === "settings" && params.get("section") === "scorecards" ? "scorecards" : undefined);
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
      setWorkspaceNotice(personalOutcome === "connected" ? "Your calendar is connected. Confirm your interview hours in My setup, then complete a test booking." : "Your calendar authorization did not complete. Connect again in My setup using your own dashboard account and approve Calendar access.");
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
    for (const key of ["application", "workspace", "reason", "jobId", "stage", "q", "assignee", "qualification", "grade", "sort", "top", "duplicate", "page", "section", "jobEditor", "jobStep", "jobStart", "jobSource", "jobSession"]) url.searchParams.delete(key);
    url.searchParams.set("view", next === "overview" ? "home" : next);
    return url;
  }
  function changeView(next: View) { navigate(viewUrl(next)); }
  function openReviewQueue() { const url = viewUrl("applications"); url.searchParams.set("stage", "Application Review"); navigate(url); }
  function beginJob() { changeView("jobs"); setCreateJob(Date.now()); }
  function selectApplication(id: string) {
    const url = new URL(window.location.href); url.searchParams.set("application", id);
    navigate(url, false, window.location.href);
  }
  function closeApplication() {
    const url = new URL(window.location.href); url.searchParams.delete("application");
    // Only traverse a predecessor that this dashboard created. A direct link stays here.
    if (window.history.state?.aiclHub && window.history.state?.candidateFrom === url.href) window.history.back();
    else {if (!url.searchParams.has("view")) url.searchParams.set("view", "applications"); navigate(url, true);}
  }
  function applyFilters(filter: string, page: number) {
    const url = viewUrl("applications");
    new URLSearchParams(filter).forEach((value, key) => url.searchParams.set(key, value));
    if (page > 1) url.searchParams.set("page", String(page));
    navigate(url);
  }
  function manageScorecards() { const url = viewUrl("settings"); url.searchParams.set("section", "scorecards"); navigate(url); }
  return (
    <div className="hiring-hub" data-hiring-workspace>
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
                className={view === item.id && !detailId ? "active" : ""}
                aria-current={
                  view === item.id && !detailId ? "page" : undefined
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
          <span>
            <strong>AI Case Leads</strong> / Hiring
          </span>
          <div>
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
          {view === "applications" && <div hidden={!!detailId}><Candidates
            key={`${initialFilter}:${initialPage}:${data?.jobs.some(job => job.id === initialJobId) ? initialJobId : ""}`}
            initialStage={initialStage}
            initialJobId={data?.jobs.some(job => job.id === initialJobId) ? initialJobId : ""}
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
              key={detailId}
              id={detailId}
              back={closeApplication}
              changed={changed}
            />
          ) : view === "overview" ? (
            <>
              <div className="hub-section-heading">
                <div><p className="hub-kicker">YOUR HIRING WORKSPACE</p><h1>What needs your attention?</h1><p>Review applicants and keep your open jobs moving.</p></div>
                <button className="hub-button" onClick={beginJob}>Create job</button>
              </div>
              <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
              <RecruitingRequests />
              {data && !resource.loading && <>
                <div className="hub-home-actions">
                  <button className="hub-card hub-home-action" onClick={openReviewQueue}><strong>{(data.stageCounts.find(stage => stage.stage === "Application Review")?.count || 0).toLocaleString()}</strong><span>In application review</span><small>Open applicant list →</small></button>
                  <button className="hub-card hub-home-action" onClick={() => changeView("applications")}><strong>{data.counts.applications.toLocaleString()}</strong><span>All applications</span><small>Open applicant list →</small></button>
                  <button className="hub-card hub-home-action" onClick={() => changeView("jobs")}><strong>{data.jobs.filter(job => job.status === "open").length}</strong><span>Open jobs</span><small>Manage job postings →</small></button>
                </div>
                <ReviewReminderQueue refresh={refresh} onSelect={selectApplication} compact />
                <section className="hub-card">
                  <div className="hub-section-heading compact"><div><h2>Your jobs</h2><p>Each posting keeps its own applicants, even when you hire again.</p></div><button className="hub-text-button" onClick={() => changeView("jobs")}>View all jobs</button></div>
                  {data.jobs.length ? <ul className="hub-home-job-list">{data.jobs.filter(job => job.status !== "closed").slice(0, 4).map(job => <li key={job.id}><div><strong>{job.title}</strong><p className="hub-muted">{job.location || "Location not set"}</p></div><Badge tone={job.status === "open" ? "success" : "neutral"}>{job.status === "open" ? "Published" : "Draft"}</Badge><button className="hub-text-button" onClick={() => changeView("jobs")}>Manage</button></li>)}{!data.jobs.some(job => job.status !== "closed") && <li>No draft or published jobs. Your closed postings are saved under Jobs.</li>}</ul> : <EmptyState title="Create your first job"><p>Start from a blank job, a saved template, or a previous posting.</p><button className="hub-button" onClick={beginJob}>Create job</button></EmptyState>}
                </section>
                <section className="hub-card">
                  <div className="hub-section-heading compact"><h2>Recent applications</h2><button className="hub-text-button" onClick={() => changeView("applications")}>View all applications</button></div>
                  {data.recentApplications.length ? <CandidateTable items={data.recentApplications} select={selectApplication} /> : <EmptyState title="No applications yet"><p>Publish a job and share its application link. New applicants will appear here.</p><button className="hub-button secondary" onClick={() => changeView("jobs")}>Open jobs</button></EmptyState>}
                </section>
                <div className="hub-home-status" aria-label="Hiring connections"><Badge tone={data.integrations.google && data.integrations.drive && data.integrations.applicationsEnabled ? "success" : "warning"}>{data.integrations.google && data.integrations.drive && data.integrations.applicationsEnabled ? "Google connected · Drive configured · Applications open" : "Setup needs attention"}</Badge><button className="hub-text-button" onClick={() => changeView("settings")}>My setup</button><button className="hub-text-button" onClick={() => changeView("tasks")}>Delivery activity</button></div>
              </>}
            </>
          ) : view === "applications" ? null : view === "jobs" ? (
            <Jobs admin={true} refresh={refresh} changed={changed} startCreating={!!createJob} onManageScorecards={manageScorecards} />
          ) : view === "reports" ? (
            <Reports refresh={refresh} />
          ) : view === "tasks" ? (
            <Tasks admin={admin} refresh={refresh} changed={changed} />
          ) : (
            <HubSettings member={member} refresh={refresh} changed={changed} jobs={data?.jobs || []} startSection={settingsSection} onDeliveryActivity={() => changeView("tasks")} />
          )}
          <footer className="hub-bottom-note">
            Hiring decisions stay with your team. Assessment and interview
            invitations require an explicit recruiter action.
          </footer>
        </main>
      </div>
    </div>
  );
}
