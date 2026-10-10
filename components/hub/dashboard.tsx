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
  Workflow,
} from "lucide-react";
import { Brand } from "@/components/careers/chrome";
import { useHubMutation, useHubResource } from "./api";
import { CandidateDetail, CandidateTable, Candidates } from "./candidates";
import { Jobs } from "./jobs";
import { Reports, Metric } from "./reports";
import { HubSettings, Tasks } from "./settings";
import { Badge, EmptyState, Feedback, ResourceState } from "./shared";
import type { Member, Overview } from "./types";

type View =
  "overview" | "applications" | "jobs" | "reports" | "tasks" | "settings";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: ClipboardList },
  { id: "jobs", label: "Roles & forms", icon: BriefcaseBusiness },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "tasks", label: "Integration tasks", icon: Workflow },
  { id: "settings", label: "Team & settings", icon: Settings2 },
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), outcome = params.get("workspace"), application = params.get("application");
    queueMicrotask(() => {
      if (application) setDetailId(application);
      if (outcome === "connection_failed") {
        const reason = params.get("reason"), messages: Record<string,string> = {
          wrong_sender: "Google authorization used a different account. Connect again using the recruiting account shown in Google connection setup.",
          missing_permissions: "Google authorization did not include all required Gmail, Calendar, and Drive permissions. Connect again and approve the requested access.",
          configuration_changed: "The Google client configuration changed during authorization. Connect Google Workspace again using the current client settings.",
          offline_grant_missing: "Google did not provide the background authorization required for recruiting tasks. Reconnect the recruiting account and approve access again.",
        };
        setWorkspaceNotice(messages[reason || ""] || "Google authorization did not complete. Review your OAuth setup and try connecting again in Team & settings."); setView("settings");
      }
      if (outcome === "connected") { setWorkspaceNotice("Google authorization completed. Confirm the recruiting sender, Calendar availability, and Drive folder in Team & settings before testing a delivery."); setView("settings"); }
    });
  }, []);
  const resource = useHubResource<Overview>("/api/hub/overview", refresh),
    mutation = useHubMutation();
  const admin = member.role === "admin",
    data = resource.data;
  function changed() {
    setRefresh((value) => value + 1);
  }
  function changeView(next: View) {
    setView(next);
    setDetailId(null);
    mutation.clear();
  }
  async function seed() {
    const result = await mutation.run(
      "/api/hub/setup",
      "POST",
      {},
      "The two draft roles were created. Open Roles & forms to configure them.",
    );
    if (result !== undefined) changed();
  }
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
              id={detailId}
              back={() => setDetailId(null)}
              changed={changed}
            />
          ) : view === "overview" ? (
            <>
              <div className="hub-section-heading">
                <div>
                  <p className="hub-kicker">YOUR HIRING OPERATIONS</p>
                  <h1>Hiring, in one place.</h1>
                  <p>
                    Applications, decisions, communications, and delivery
                    status.
                  </p>
                </div>
              </div>
              <ResourceState
                loading={resource.loading}
                error={resource.error}
                retry={() => void resource.reload()}
              />
              {data && !resource.loading && (
                <>
                  <div className="hub-metric-grid">
                    <Metric
                      label="Applications"
                      value={data.counts.applications.toLocaleString()}
                    />
                    <Metric
                      label="Active applications"
                      value={data.counts.active.toLocaleString()}
                    />
                    <Metric
                      label="Rejected"
                      value={data.counts.rejected.toLocaleString()}
                    />
                    <Metric
                      label="Hired"
                      value={data.counts.hired.toLocaleString()}
                    />
                  </div>
                  <section className="hub-card hub-setup-card">
                    <div className="hub-section-heading compact">
                      <div>
                        <h2>
                          {data.integrations.applicationsEnabled
                            ? "Platform status"
                            : "Get ready to hire"}
                        </h2>
                        <p>
                          {data.integrations.applicationsEnabled
                            ? "Keep integration delivery healthy and review every hiring step."
                            : "Configure your roles and company integrations, then complete launch checks before accepting applications."}
                        </p>
                      </div>
                      <Badge
                        tone={
                          data.integrations.applicationsEnabled
                            ? "success"
                            : "warning"
                        }
                      >
                        {data.integrations.applicationsEnabled
                          ? "Intake enabled"
                          : "Intake remains closed"}
                      </Badge>
                    </div>
                    <div className="hub-setup-grid">
                      <div>
                        <span>01</span>
                        <strong>Roles & forms</strong>
                        <p>
                          {data.jobs.length} configured roles ·{" "}
                          {
                            data.jobs.filter((job) => job.status === "open")
                              .length
                          }{" "}
                          open
                        </p>
                        <button
                          className="hub-text-button"
                          onClick={() => changeView("jobs")}
                        >
                          Manage roles
                        </button>
                      </div>
                      <div>
                        <span>02</span>
                        <strong>Google Workspace</strong>
                        <p>
                          {data.integrations.google
                            ? "Company connection ready"
                            : "Email and Calendar not connected"}
                        </p>
                        {admin && (
                          <button
                            className="hub-text-button"
                            onClick={() => changeView("settings")}
                          >
                            Configure connection
                          </button>
                        )}
                      </div>
                      <div>
                        <span>03</span>
                        <strong>Drive archival</strong>
                        <p>
                          {data.integrations.drive
                            ? "Recruiting archive configured"
                            : "Recruiting folder not configured"}
                        </p>
                        <button
                          className="hub-text-button"
                          onClick={() => changeView("tasks")}
                        >
                          Review delivery tasks
                        </button>
                      </div>
                    </div>
                    {data.jobs.length === 0 && (
                      <div className="hub-seed-row">
                        <p>
                          Start with Full-stack Engineer and Creative
                          Strategist. No qualifications or compensation are
                          invented.
                        </p>
                        {admin ? (
                          <button
                            className="hub-button"
                            disabled={mutation.busy}
                            onClick={() => void seed()}
                          >
                            {mutation.busy
                              ? "Creating draft roles…"
                              : "Create the two draft roles"}
                          </button>
                        ) : (
                          <p className="hub-muted">
                            Ask an administrator to create your first roles.
                          </p>
                        )}
                      </div>
                    )}
                    <Feedback
                      error={mutation.error}
                      success={mutation.success}
                    />
                  </section>
                  <section className="hub-card">
                    <div className="hub-section-heading compact">
                      <h2>Recent applications</h2>
                      <button
                        className="hub-text-button"
                        onClick={() => changeView("applications")}
                      >
                        View all applications
                      </button>
                    </div>
                    {data.recentApplications.length ? (
                      <CandidateTable
                        items={data.recentApplications}
                        select={setDetailId}
                      />
                    ) : (
                      <EmptyState title="Your first applications will appear here">
                        <p>
                          Accepted submissions become searchable hiring records
                          with answers and original files.
                        </p>
                        <button
                          className="hub-button secondary"
                          onClick={() => changeView("jobs")}
                        >
                          Review the role forms
                        </button>
                      </EmptyState>
                    )}
                  </section>
                  <section className="hub-card">
                    <h2>Current hiring stages</h2>
                    {data.stageCounts.length ? (
                      <div className="hub-stage-grid">
                        {data.stageCounts.map((stage) => (
                          <div key={stage.stage}>
                            <strong>{stage.count}</strong>
                            <span>{stage.stage}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="hub-muted">
                        No applications have entered the pipeline yet.
                      </p>
                    )}
                  </section>
                </>
              )}
            </>
          ) : view === "applications" ? (
            <Candidates
              reviewerEmail={member.email}
              jobs={data?.jobs || []}
              refresh={refresh}
              changed={changed}
            />
          ) : view === "jobs" ? (
            <Jobs admin={admin} refresh={refresh} changed={changed} />
          ) : view === "reports" ? (
            <Reports refresh={refresh} />
          ) : view === "tasks" ? (
            <Tasks admin={admin} refresh={refresh} changed={changed} />
          ) : admin ? (
            <HubSettings member={member} refresh={refresh} changed={changed} />
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
