"use client";
import { useEffect, useState } from "react";
import { isMailSetupError } from "../../lib/google/mail-setup";
import { driveArchivePhases, isDriveArchiveContinuation } from "../../lib/hub/task-progress";
import { ExternalLink } from "lucide-react";
import {
  displayDate,
  safeNavigation,
  useHubMutation,
  useHubResource,
} from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { HubJob, Member, Settings, Task } from "./types";
import { GoogleConfiguration } from "./google-setup";
import { SchedulerSetup } from "./scheduler-setup";
import { driveFolderId } from "./drive-folder";
import { AiReviewSettings } from "./ai-review";
import { ScorecardTemplates } from "./scorecards";
import { ReviewReminderSettings } from "./review-reminders";
import { PersonalMailSetup } from "./personal-mail";
import { PersonalCalendarSetup } from "./personal-calendar";
import { TeamAccess } from "./team-access";
import { RecruitingRequests } from "./recruiting-help";

export function HubSettings({
  member, refresh, changed, jobs = [], startSection, onDeliveryActivity,
}: {
  member: Member; refresh: number; changed: () => void; jobs?: HubJob[];
  startSection?: "scorecards"; onDeliveryActivity?: () => void;
}) {
  const owner = member.isOwner === true;
  const managesTeam = member.role === "admin";
  const [section, setSection] = useState<"personal" | "team" | "company" | "scorecards" | "help">(startSection === "scorecards" ? "scorecards" : "personal");
  useEffect(() => { if (startSection === "scorecards") queueMicrotask(() => setSection("scorecards")); }, [startSection]);
  const sections = [
    { id: "personal" as const, label: "My connections" },
    ...(managesTeam ? [{ id: "team" as const, label: "Team" }] : []),
    ...(owner ? [{ id: "company" as const, label: "Company" }] : []),
    { id: "help" as const, label: "Help requests" },
    { id: "scorecards" as const, label: "Templates" },
  ];
  return <section className="hub-settings" aria-labelledby="settings-title">
    <div className="hub-section-heading"><div><p className="hub-kicker">WORKSPACE</p><h2 id="settings-title">Settings</h2><p>Manage your connections and your team’s workspace.</p></div>
      <a className="hub-text-button hub-inline-guide" href="/recruiter-guide.pdf" target="_blank" rel="noopener noreferrer">Recruiter guide (PDF) <ExternalLink size={15} /></a>
    </div>
    <nav className="hub-page-tabs" aria-label="Settings sections">
      {sections.map(item => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} className={"hub-text-button " + (section === item.id ? "active" : "")} onClick={() => setSection(item.id)}>{item.label}</button>)}
    </nav>
    <div className="hub-setting-panel">
      {section === "personal" && <>
        <p className="hub-muted">Sign in with your own account, connect email and Calendar, then set your interview hours. Job notifications go to the people selected on each job.</p>
        <PersonalMailSetup member={member} refresh={refresh} />
        <PersonalCalendarSetup key={member.email} member={member} refresh={refresh} />
      </>}
      {section === "team" && managesTeam && <><TeamAccess member={member} changed={changed} refresh={refresh} /><details className="hub-card hub-setup-details"><summary>Review reminders</summary><ReviewReminderSettings /></details></>}
      {section === "scorecards" && <><p className="hub-muted">Optional reusable review criteria for teams that want manual scorecards. AI matching uses each job’s description and applicant evidence.</p><section className="hub-card" id="scorecard-settings"><ScorecardTemplates jobs={jobs} /></section></>}
      {section === "help" && <RecruitingRequests />}
      {section === "company" && owner && <CompanySettings member={member} refresh={refresh} changed={changed} jobs={jobs} onDeliveryActivity={onDeliveryActivity} />}
    </div>
  </section>;
}

function CompanySettings({ member, refresh, changed, jobs, onDeliveryActivity }: { member:Member; refresh:number; changed:()=>void; jobs:HubJob[]; onDeliveryActivity?:()=>void }) {
  const resource = useHubResource<Settings>("/api/hub/settings", refresh);
  return <>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
    {resource.data && !resource.loading && <SettingsForm key={JSON.stringify(resource.data)} initial={resource.data} member={member} jobs={jobs} onDeliveryActivity={onDeliveryActivity} changed={() => { changed(); void resource.reload(); }} />}
  </>;
}
function SettingsForm({
  initial,
  changed,
  onDeliveryActivity,
}: {
  initial: Settings;
  member: Member;
  changed: () => void;
  jobs: HubJob[];
  startSection?: "scorecards";
  onDeliveryActivity?: () => void;
}) {
  const [calendarId, setCalendarId] = useState(initial.google.calendarId || ""),
    [driveRootId, setDriveRootId] = useState(initial.google.driveRootId || ""),
    [rejectionTemplate, setRejectionTemplate] = useState(
      initial.templates.rejection || "",
    ),
    [timeZone, setTimeZone] = useState(
      initial.scheduling?.timeZone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC",
    ),
    [startHour, setStartHour] = useState(
      String(initial.scheduling?.startHour ?? 10),
    ),
    [endHour, setEndHour] = useState(String(initial.scheduling?.endHour ?? 16)),
    [duration, setDuration] = useState(
      String(initial.scheduling?.durationMinutes ?? 30),
    ),
    [weekdays, setWeekdays] = useState<number[]>(
      initial.scheduling?.weekdays || [1, 2, 3, 4, 5],
    ),
    [remindersEnabled, setRemindersEnabled] = useState(
      initial.scheduling?.remindersEnabled ?? false,
    );
  const mutation = useHubMutation(),
    connection = useHubMutation();
  const runtime = useHubResource<{
    configured: boolean;
    hostingPlatform?: string;
    backgroundEnabled?: boolean;
  }>("/api/google/status");
  const [validationError, setValidationError] = useState("");
  const savedDriveId = driveFolderId(initial.google.driveRootId || "");
  const connectedAccount = initial.google.connected ? initial.google.sender : "";
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const folderId = driveFolderId(driveRootId);
    if (folderId === null) {
      setValidationError("Paste a Google Drive folder link (https://drive.google.com/drive/folders/…) or its folder ID.");
      return;
    }
    setValidationError("");
    const result = await mutation.run(
      "/api/hub/settings",
      "PATCH",
      {
        settingsVersion: initial.settingsVersion,
        calendarId: calendarId.trim(),
        driveRootId: folderId,
        rejectionTemplate,
        interviewTimeZone: timeZone,
        interviewStartHour: Number(startHour),
        interviewEndHour: Number(endHour),
        interviewDurationMinutes: Number(duration),
        interviewWeekdays: weekdays,
        interviewRemindersEnabled: remindersEnabled,
      },
      "Settings saved.",
    );
    if (result !== undefined) changed();
  }
  async function connect() {
    const result = await connection.run<{ url: string }>(
      "/api/google/connect",
      "POST",
      {},
      "Opening Google authorization…",
    );
    if (result?.url && safeNavigation(result.url))
      window.location.assign(result.url);
  }
  const [area, setArea] = useState<"storage" | "ai" | "notifications" | "advanced">("storage");
  const areas = [{id:"storage" as const,label:"Files & calendar"},{id:"ai" as const,label:"AI"},{id:"notifications" as const,label:"Messages & reminders"},{id:"advanced" as const,label:"Advanced"}];
  return <div className="hub-settings-stack hub-company-settings">
    {initial.queue.failed > 0 && <div className="hub-notice hub-error hub-inline-alert" role="alert"><span>{initial.queue.failed} delivery tasks need attention.</span>{onDeliveryActivity && <button className="hub-text-button" type="button" onClick={onDeliveryActivity}>View delivery activity</button>}</div>}
    {runtime.data?.hostingPlatform === "railway" && !runtime.data.backgroundEnabled && <div className="hub-notice hub-error hub-inline-alert" role="alert"><span>Automatic email, calendar, and file processing is disabled.</span><button type="button" className="hub-text-button" onClick={() => setArea("advanced")}>Open background setup</button></div>}
    <nav className="hub-company-tabs hub-page-tabs" aria-label="Company settings sections">{areas.map(item => <button className={"hub-text-button " + (area === item.id ? "active" : "")} type="button" aria-current={area === item.id ? "page" : undefined} onClick={() => setArea(item.id)} key={item.id}>{item.label}</button>)}</nav>
    {area === "storage" && <section className="hub-card">
      <div className="hub-section-heading compact"><div><h3>Company Google connection</h3><p>Stores applicant files in Drive and provides an optional shared interview calendar.</p></div><Badge tone={initial.google.connected ? "success" : "warning"}>{initial.google.connected ? "Connected" : "Not connected"}</Badge></div>
      <ResourceState loading={runtime.loading} error={runtime.error} retry={() => void runtime.reload()} />
      {runtime.data?.configured === false && <p className="hub-notice hub-error" role="alert">Google client setup is missing. Open Advanced to finish setup before connecting.</p>}
      <p className="hub-muted">{connectedAccount ? "Connected as " + connectedAccount : "No account connected"}. Each recruiter’s email and calendar are managed under My connections.</p>
      <div className="hub-button-row"><button className="hub-button secondary" type="button" onClick={() => void connect()} disabled={connection.busy || runtime.loading || runtime.data?.configured === false}>{connection.busy ? "Connecting…" : initial.google.connected ? "Reconnect company Google" : "Connect company Google"} <ExternalLink size={15} /></button><button className="hub-text-button" type="button" onClick={() => void runtime.reload()} disabled={runtime.loading}>Check connection</button></div>
      <Feedback error={connection.error} success={connection.success} />
      {!initial.google.connected && <p className="hub-muted">Choose {initial.google.expectedSender || "the configured company account"} when Google opens.</p>}
    </section>}
    {(area === "storage" || area === "notifications") && <form onSubmit={save} className="hub-company-settings-form"><fieldset className="hub-settings-stack" disabled={mutation.busy}>
      {area === "storage" && <>
        <section className="hub-card"><div className="hub-section-heading compact"><div><h3>Applicant file storage</h3><p>All postings stay archived, including earlier rounds of hiring.</p></div><Badge tone={initial.google.driveRootId ? "success" : "warning"}>{initial.google.driveRootId ? "Folder saved" : "Choose a folder"}</Badge></div>
          <Field label="Shared Google Drive folder" hint="Paste a shared folder link or folder ID. The connected company account needs permission to add files."><input value={driveRootId} onChange={e => setDriveRootId(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" /></Field>
          {savedDriveId && <a className="hub-text-button" href={"https://drive.google.com/drive/folders/" + encodeURIComponent(savedDriveId)} target="_blank" rel="noopener noreferrer">Open saved folder <ExternalLink size={15} /></a>}
          <details className="hub-setup-details"><summary>How files are organized</summary><p className="hub-muted">Recruiting → Job → Location → Posting → Applicant. Each application has its own folder. Give hiring managers access to the shared folder. Check a test application’s Drive link to confirm uploads; accepted applications are kept even during a temporary Drive outage.</p></details>
        </section>
        <details className="hub-card hub-setup-details"><summary>Shared interview calendar (optional)</summary><p className="hub-muted">Recruiters normally use their own calendars. These settings apply when you explicitly choose the shared company calendar for an invitation.</p>
          <button type="button" className="hub-text-button" disabled={!connectedAccount} onClick={() => setCalendarId(connectedAccount)}>Use connected account’s calendar</button>
          <div className="hub-form-grid">
            <Field label="Interview calendar" hint="Calendar owner's email, or Calendar ID from Google Calendar settings."><input value={calendarId} onChange={e => setCalendarId(e.target.value)} placeholder="Calendar email or ID" /></Field>
            <Field label="Interview time zone" hint="For example America/Bogota or Europe/Madrid."><input value={timeZone} onChange={e => setTimeZone(e.target.value)} required /></Field>
            <Field label="First available hour"><select value={startHour} onChange={e => setStartHour(e.target.value)}>{Array.from({length:24},(_,hour)=><option value={hour} key={hour}>{String(hour).padStart(2,"0")}:00</option>)}</select></Field>
            <Field label="Finish by"><select value={endHour} onChange={e => setEndHour(e.target.value)}>{Array.from({length:24},(_,i)=>i+1).map(hour=><option value={hour} key={hour}>{hour===24 ? "Midnight" : String(hour).padStart(2,"0")+":00"}</option>)}</select></Field>
            <Field label="Interview length"><input type="number" min="15" max="120" step="5" value={duration} onChange={e => setDuration(e.target.value)} required /></Field>
          </div>
          <div className="hub-weekdays" role="group" aria-label="Interview days">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index)=><label className="hub-checkbox" key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={e => setWeekdays(current => e.target.checked ? [...current,index].sort() : current.filter(value => value !== index))} />{day}</label>)}</div>
          <p className="hub-muted">Saved hours do not move existing interviews. Complete a test booking to confirm Calendar access and Meet creation. Resolve active interviews before switching calendars.</p>
        </details>
      </>}
      {area === "notifications" && <>
        <section className="hub-card"><h3>Default rejection message</h3><p className="hub-muted">Used when creating new jobs. Existing jobs keep their saved message and screening rules.</p><Field label="Approved template"><textarea rows={6} value={rejectionTemplate} onChange={e => setRejectionTemplate(e.target.value)} /></Field></section>
        <section className="hub-card"><h3>Interview reminders</h3><label className="hub-checkbox"><input type="checkbox" checked={remindersEnabled} onChange={e => setRemindersEnabled(e.target.checked)} />Send reminders for confirmed interviews</label><p className="hub-muted">24 hours and 1 hour before a future booking. Requires the connected recruiting Gmail account. Cancelled and replaced bookings are skipped.</p></section>
      </>}
      <div className="hub-settings-save" role="group" aria-label="Save company settings"><button className="hub-button" type="submit" disabled={mutation.busy}>{mutation.busy ? "Saving…" : "Save company settings"}</button><Feedback error={validationError || mutation.error} success={validationError ? "" : mutation.success} /></div>
    </fieldset></form>}
    {area === "ai" && <AiReviewSettings />}
    {area === "notifications" && <>
      <details className="hub-card hub-setup-details"><summary>Recruiter notifications & overdue reviews</summary><p className="hub-muted">Choose notification recipients on each job. Your login does not automatically subscribe you to every job.</p><ReviewReminderSettings /></details>
      {initial.mailSync?.lastError && <p className="hub-notice hub-error" role="alert">Email reply sync: {initial.mailSync.lastError}</p>}
      {initial.mailSync?.lastCheckedAt && <p className="hub-muted">Email replies last checked {displayDate(initial.mailSync.lastCheckedAt)}.</p>}
    </>}
    {area === "advanced" && <>
      <details className="hub-card hub-setup-details"><summary>Google app configuration</summary><p className="hub-muted">Installation settings. Recruiters connect their own accounts under My connections.</p><GoogleConfiguration /></details>
      <details className="hub-card hub-setup-details"><summary>Background processing</summary><SchedulerSetup /></details>
      <details className="hub-card hub-setup-details"><summary>Privacy & applicant requests</summary><p>Applicants can request help or exercise privacy rights using the website. Review submitted requests under Settings → Help requests.</p><a className="hub-text-button" href="/privacy" target="_blank" rel="noopener noreferrer">Open privacy notice <ExternalLink size={15} /></a></details>
      {initial.accessAudit && <details className="hub-card hub-setup-details"><summary>Access history</summary><p className="hub-muted">The 50 most recent recorded access changes.</p>{initial.accessAudit.length ? initial.accessAudit.map(event => <article key={event.id} className="hub-history-item"><strong>{event.type} · {event.actor}</strong><small>{displayDate(event.createdAt)}</small><details><summary>Recorded change</summary><pre className="hub-preserve">{JSON.stringify({before:event.before,after:event.after},null,2)}</pre></details></article>) : <p className="hub-muted">No access changes recorded.</p>}</details>}
    </>}
  </div>;
}

export function Tasks({
  admin,
  refresh,
  changed,
}: {
  admin: boolean;
  refresh: number;
  changed: () => void;
}) {
  const [page, setPage] = useState(1);
  const resource = useHubResource<Task[]>(
      "/api/hub/tasks?page=" + page,
      refresh,
    ),
    mutation = useHubMutation();
  const mail = useHubResource<{connected:boolean;candidateConnected:boolean;candidateAccount:string|null}>("/api/personal-mail", refresh);
  const mailSetupError = (task: Task) => task.kind === "gmail" && isMailSetupError(task.lastError || "");
  const setupExplanation = (error: string) => ({
    candidate_mail_account_not_configured: "An administrator must assign the automatic recruiting email account.",
    candidate_mail_account_connection_required: "The assigned recruiter must connect their own recruiting Gmail.",
    gmail_sender_alias_not_verified: "Verify the no-reply sender in the recruiter’s Gmail Send mail as settings.",
    google_oauth_reconnect_required: "Reconnect the recruiting Gmail account; its authorization has expired or changed.",
    google_required_permissions_missing: "Reconnect recruiting Gmail and grant the required permissions.",
    recruiter_reply_contact_required: "Assign a connected recruiter as the job’s reply contact.",
    candidate_mail_exposes_staff_address: "Update the email template to remove the private staff address before sending.",
  }[error] || "Recruiting email setup needs attention.");
  const [processResult, setProcessResult] = useState<{
    processed?: number;
    replies?: number;
    mailSyncFailures?: number;
    configured?: boolean;
  } | null>(null);
  async function retry(id: string) {
    const result = await mutation.run(
      "/api/hub/tasks/" + encodeURIComponent(id) + "/retry",
      "POST",
      {},
      "Task queued for a safe retry.",
    );
    if (result !== undefined) {
      changed();
      void resource.reload();
    }
  }
  async function process() {
    const result = await mutation.run<{
      processed?: number;
      replies?: number;
      mailSyncFailures?: number;
      configured?: boolean;
    }>(
      "/api/hub/process",
      "POST",
      {},
      "Task check completed. Review delivery status below.",
    );
    if (result !== undefined) {
      setProcessResult(result);
      changed();
      void resource.reload();
    }
  }
  return (
    <section aria-labelledby="tasks-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">DELIVERY & RECOVERY</p>
          <h2 id="tasks-title">Delivery activity</h2>
          <p>
            Email, Calendar, and Drive work is recorded here with retry and
            delivery status. Unattended processing requires the configured
            background scheduler.
          </p>
        </div>
        <div className="hub-button-row">
          <button
            className="hub-button secondary"
            onClick={() => void resource.reload()}
            disabled={resource.loading}
          >
            Refresh
          </button>
          {admin && (
            <button
              className="hub-button"
              onClick={() => void process()}
              disabled={mutation.busy}
            >
              Process pending tasks
            </button>
          )}
        </div>
      </div>
      {mail.data?.candidateConnected === false && <p className="hub-notice">Automatic recruiting email is not connected. {mail.data.candidateAccount || "The assigned recruiter"} must sign in and connect their own Gmail under Settings → My connections. Other recruiters can use their own connected mailboxes. Company Drive and Calendar connections do not enable recruiting email. <a className="hub-button secondary" href="/team?view=settings">Connect recruiting email</a></p>}
      <Feedback error={mutation.error} success={mutation.success} />
      {processResult && (
        <p
          className={
            "hub-notice " + (processResult.mailSyncFailures ? "hub-error" : "")
          }
          role="status"
        >
          {typeof processResult.processed === "number"
            ? "Processed " + processResult.processed + " tasks. "
            : ""}
          {typeof processResult.replies === "number"
            ? "Recorded " + processResult.replies + " email replies. "
            : ""}
          {processResult.mailSyncFailures
            ? processResult.mailSyncFailures +
              " email reply checks failed. Review the integration status."
            : ""}
          {processResult.configured === false
            ? "Google Workspace is not connected yet."
            : ""}
        </p>
      )}
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data &&
        !resource.loading &&
        (resource.data.length ? (
          <div className="hub-table-wrap">
            <table className="hub-table">
              <thead>
                <tr>
                  <th scope="col">Integration</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Details</th>
                  <th scope="col">Recovery</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.kind}</strong>
                      <span className="hub-secondary-line">
                        {task.applicationId || ""}
                      </span>
                    </td>
                    <td>
                      <Badge
                        tone={
                          task.status === "failed" ||
                          task.status === "uncertain"
                            ? "danger"
                            : task.status === "done"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {isDriveArchiveContinuation(task) ? "Archiving files" : mailSetupError(task) ? "Setup required" : task.status}
                      </Badge>
                    </td>
                    <td>{task.attempts}</td>
                    <td>{displayDate(task.updatedAt)}</td>
                    <td className={isDriveArchiveContinuation(task) ? "hub-muted" : "hub-task-error"}>
                      {isDriveArchiveContinuation(task)
                        ? "Progress saved; the background worker will continue automatically."
                        : mailSetupError(task) ? setupExplanation(task.lastError || "") + " This message is held; connecting Gmail alone will not send it." : task.lastError || "—"}
                      {task.phase && <span className="hub-secondary-line">{driveArchivePhases[task.phase]}</span>}
                      {task.providerStatus && <span className="hub-secondary-line">Google response: {task.providerStatus}</span>}
                    </td>
                    <td>
                      {mailSetupError(task) ? (
                        <div><a className="hub-button secondary" href="/team?view=settings">Connect recruiting email</a>{admin && (mail.data?.candidateConnected === true || mail.data?.connected === true) && task.status === "failed" && <button type="button" className="hub-button secondary" disabled={mutation.busy} onClick={() => {if (window.confirm("Have you reviewed this held message and corrected its sender, permissions and template? Retrying can send it to the applicant.")) void retry(task.id);}}>Review and retry held message</button>}</div>
                      ) : task.status === "uncertain" && task.kind === "calendar" ? (
                        <button
                          className="hub-button secondary"
                          disabled={mutation.busy}
                          onClick={() => void retry(task.id)}
                        >
                          Reconcile Calendar
                        </button>
                      ) : task.status === "uncertain" ? (
                        <span className="hub-muted">
                          Gmail delivery is being checked against sent messages.
                          Resending is blocked while the result is uncertain.
                        </span>
                      ) : task.status === "failed" ? (
                        <button
                          className="hub-button secondary"
                          disabled={mutation.busy}
                          onClick={() => void retry(task.id)}
                        >
                          Retry safely
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No integration tasks yet">
            <p>
              Accepted applications create Drive tasks. Recruiter communications
              and bookings create email and Calendar tasks.
            </p>
          </EmptyState>
        ))}
      {resource.data && !resource.loading && (
        <div className="hub-pagination">
          <button
            className="hub-button secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} · {resource.data.length} tasks on this page
          </span>
          <button
            className="hub-button secondary"
            disabled={resource.data.length < 200}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
