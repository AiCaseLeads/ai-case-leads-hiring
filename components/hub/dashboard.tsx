"use client";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
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
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [createJob, setCreateJob] = useState(0);
  const [initialStage, setInitialStage] = useState("");
  const [initialJobId, setInitialJobId] = useState("");
  const [settingsSection, setSettingsSection] = useState<"scorecards" | undefined>();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), outcome = params.get("workspace"), application = params.get("application"), requestedView = params.get("view");
    queueMicrotask(() => {
      if (requestedView && ["home", "overview", "applications", "jobs", "reports", "tasks", ...(member.role === "admin" ? ["settings"] : [])].includes(requestedView)) setView(requestedView === "home" ? "overview" : requestedView as View);
      const requestedStage = params.get("stage"); if (requestedView === "applications" && requestedStage && stages.includes(requestedStage)) setInitialStage(requestedStage);
      if (application) setDetailId(application);
      if (outcome === "connection_failed") {
        const reason = params.get("reason"), messages: Record<string,string> = {
          wrong_sender: "Google authorization used a different account. Connect again using the recruiting account shown in Google connection setup.",
          missing_permissions: "Google authorization did not include all required Gmail, Calendar, and Drive permissions. Connect again and approve the requested access.",
          configuration_changed: "The Google client configuration changed during authorization. Connect Google Workspace again using the current client settings.",
          offline_grant_missing: "Google did not provide the background authorization required for recruiting tasks. Reconnect the recruiting account and approve access again.",
        };
        setWorkspaceNotice(messages[reason || ""] || "Google authorization did not complete. Review your OAuth setup and try connecting again in Settings."); setView("settings");
      }
      if (outcome === "connected") { setWorkspaceNotice("Google authorization completed. Confirm the recruiting sender, Calendar availability, and Drive folder in Settings before testing a delivery."); setView("settings"); }
    });
  }, [member.role]);
  const resource = useHubResource<Overview>("/api/hub/overview", refresh);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), jobId = params.get("jobId");
    if (params.get("view") === "applications" && jobId && resource.data?.jobs.some(job => job.id === jobId)) queueMicrotask(() => setInitialJobId(jobId));
  }, [resource.data]);
  const admin = member.role === "admin",
    data = resource.data;
  function changed() {
    setRefresh((value) => value + 1);
  }
  function changeView(next: View) {
    setView(next);
    setDetailId(null);
    setCreateJob(0);
    setInitialStage("");
    setInitialJobId("");
    setSettingsSection(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next === "overview" ? "home" : next);
    url.searchParams.delete("application");
    url.searchParams.delete("workspace");
    url.searchParams.delete("reason");
    url.searchParams.delete("jobId");
    url.searchParams.delete("stage");
    window.history.replaceState(null, "", url);
  }
  function openReviewQueue() { changeView("applications"); setInitialStage("Application Review"); const url = new URL(window.location.href); url.searchParams.set("stage", "Application Review"); window.history.replaceState(null, "", url); }
  function beginJob() { changeView("jobs"); setCreateJob(Date.now()); }
  function selectApplication(id: string) {
    setDetailId(id); const url = new URL(window.location.href); url.searchParams.set("application", id); window.history.replaceState(null, "", url);
  }
  function closeApplication() { setDetailId(null); const url = new URL(window.location.href); url.searchParams.delete("application"); window.history.replaceState(null, "", url); }
  function manageScorecards() { changeView("settings"); setSettingsSection("scorecards"); }
  return (
    <div className="hiring-hub">
      <a href="#hub-main" className="skip-link">
        Skip to hiring workspace
      </a>
      <aside className="hub-sidebar">
        <Brand />
        <div className="hub-workspace-label">HIRING WORKSPACE</div>
        <nav aria-label="Hiring workspace">
          {navigation
            .filter((item) => item.id !== "settings" || admin)
            .map((item) => (
              <button
                key={item.id}
                className={view === item.id && !detailId ? "active" : ""}
                aria-current={
                  view === item.id && !detailId ? "page" : undefined
                }
                onClick={() => changeView(item.id)}
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
          <Badge>{admin ? "Administrator" : "Recruiter"}</Badge>
          <a href={signOutHref}>
            <LogOut size={15} /> Sign out
          </a>
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
                {admin && <button className="hub-button" onClick={beginJob}>Create job</button>}
              </div>
              <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
              {data && !resource.loading && <>
                <div className="hub-home-actions">
                  <button className="hub-card hub-home-action" onClick={openReviewQueue}><strong>{(data.stageCounts.find(stage => stage.stage === "Application Review")?.count || 0).toLocaleString()}</strong><span>In application review</span><small>Open applicant list →</small></button>
                  <button className="hub-card hub-home-action" onClick={() => changeView("applications")}><strong>{data.counts.applications.toLocaleString()}</strong><span>All applications</span><small>Open applicant list →</small></button>
                  <button className="hub-card hub-home-action" onClick={() => changeView("jobs")}><strong>{data.jobs.filter(job => job.status === "open").length}</strong><span>Open jobs</span><small>Manage job postings →</small></button>
                </div>
                <ReviewReminderQueue refresh={refresh} onSelect={selectApplication} compact />
                <section className="hub-card">
                  <div className="hub-section-heading compact"><div><h2>Your jobs</h2><p>Each posting keeps its own applicants, even when you hire again.</p></div><button className="hub-text-button" onClick={() => changeView("jobs")}>View all jobs</button></div>
                  {data.jobs.length ? <ul className="hub-home-job-list">{data.jobs.filter(job => job.status !== "closed").slice(0, 4).map(job => <li key={job.id}><div><strong>{job.title}</strong><p className="hub-muted">{job.location || "Location not set"}</p></div><Badge tone={job.status === "open" ? "success" : "neutral"}>{job.status === "open" ? "Published" : "Draft"}</Badge><button className="hub-text-button" onClick={() => changeView("jobs")}>Manage</button></li>)}{!data.jobs.some(job => job.status !== "closed") && <li>No draft or published jobs. Your closed postings are saved under Jobs.</li>}</ul> : <EmptyState title="Create your first job"><p>Start from a blank job, a saved template, or a previous posting.</p>{admin && <button className="hub-button" onClick={beginJob}>Create job</button>}</EmptyState>}
                </section>
                <section className="hub-card">
                  <div className="hub-section-heading compact"><h2>Recent applications</h2><button className="hub-text-button" onClick={() => changeView("applications")}>View all applications</button></div>
                  {data.recentApplications.length ? <CandidateTable items={data.recentApplications} select={selectApplication} /> : <EmptyState title="No applications yet"><p>Publish a job and share its application link. New applicants will appear here.</p><button className="hub-button secondary" onClick={() => changeView("jobs")}>Open jobs</button></EmptyState>}
                </section>
                <div className="hub-home-status" aria-label="Hiring connections"><Badge tone={data.integrations.google && data.integrations.drive && data.integrations.applicationsEnabled ? "success" : "warning"}>{data.integrations.google && data.integrations.drive && data.integrations.applicationsEnabled ? "Google connected · Drive configured · Applications open" : "Setup needs attention"}</Badge>{admin && <button className="hub-text-button" onClick={() => changeView("settings")}>Connection settings</button>}<button className="hub-text-button" onClick={() => changeView("tasks")}>Delivery activity</button></div>
              </>}
            </>
          ) : view === "applications" ? (
            <Candidates
              key={`${initialStage}:${initialJobId}`}
              initialStage={initialStage}
              initialJobId={initialJobId}
              reviewerEmail={member.email}
              jobs={data?.jobs || []}
              refresh={refresh}
              changed={changed}
            />
          ) : view === "jobs" ? (
            <Jobs key={createJob} admin={admin} refresh={refresh} changed={changed} startCreating={!!createJob} onManageScorecards={manageScorecards} />
          ) : view === "reports" ? (
            <Reports refresh={refresh} />
          ) : view === "tasks" ? (
            <Tasks admin={admin} refresh={refresh} changed={changed} />
          ) : admin ? (
            <HubSettings member={member} refresh={refresh} changed={changed} jobs={data?.jobs || []} startSection={settingsSection} onDeliveryActivity={() => changeView("tasks")} />
          ) : null}
          <footer className="hub-bottom-note">
            Hiring decisions stay with your team. Assessment and interview
            invitations require an explicit recruiter action.
          </footer>
        </main>
      </div>
    </div>
  );
}
