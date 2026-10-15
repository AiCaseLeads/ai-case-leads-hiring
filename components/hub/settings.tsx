"use client";
import { useEffect, useState } from "react";
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
import { PersonalCalendarSetup } from "./personal-calendar";
import { TeamAccess } from "./team-access";

export function HubSettings({
  member,
  refresh,
  changed,
  jobs = [],
  startSection,
  onDeliveryActivity,
}: {
  member: Member;
  refresh: number;
  changed: () => void;
  jobs?: HubJob[];
  startSection?: "scorecards";
  onDeliveryActivity?: () => void;
}) {
  const owner = member.isOwner === true;
  const managesTeam = member.role === "admin";
  const [section, setSection] = useState<"personal" | "team" | "company" | "scorecards">(startSection === "scorecards" ? "scorecards" : "personal");
  useEffect(() => { if (startSection === "scorecards") queueMicrotask(() => setSection("scorecards")); }, [startSection]);
  return (
    <section className="hub-settings" aria-labelledby="settings-title">
      <div className="hub-section-heading">
        <div><p className="hub-kicker">YOUR WORKSPACE</p><h2 id="settings-title">Settings</h2>
          <p>Your own calendar, your hiring team, and company connections each have their own place.</p>
        </div>
      </div>
      <nav className="hub-button-row hub-settings-navigation" aria-label="Settings sections">
        <button type="button" aria-current={section === "personal" ? "page" : undefined} className={"hub-button " + (section === "personal" ? "" : "secondary")} onClick={() => setSection("personal")}>My setup</button>
        {managesTeam && <button type="button" aria-current={section === "team" ? "page" : undefined} className={"hub-button " + (section === "team" ? "" : "secondary")} onClick={() => setSection("team")}>Team access &amp; invitations</button>}
        <button type="button" aria-current={section === "scorecards" ? "page" : undefined} className={"hub-button " + (section === "scorecards" ? "" : "secondary")} onClick={() => setSection("scorecards")}>Scorecard templates</button>
        {owner && <button type="button" aria-current={section === "company" ? "page" : undefined} className={"hub-button " + (section === "company" ? "" : "secondary")} onClick={() => setSection("company")}>Company setup</button>}
      </nav>
      {section === "personal" && <>
        <section className="hub-card"><h3>Welcome, {member.email}</h3><p>You sign in with your own Google Workspace account. Never share your password with another teammate.</p>
          <ol className="hub-onboarding-steps"><li><strong>Connect your calendar below.</strong> Google will ask you to approve access to your own interview calendar.</li><li><strong>Set your interview hours.</strong> Choose your time zone, days, and hours, then save.</li><li><strong>Create or join a job.</strong> Open Jobs to create a posting. Under Hiring team &amp; emails, select the people who should receive its alerts.</li><li><strong>Review, then invite.</strong> Open an applicant, choose an interviewer, and send a booking link after your review.</li></ol>
          <p><a className="hub-button secondary" href="/recruiter-guide.pdf" target="_blank" rel="noopener noreferrer">Open recruiter guide (PDF) <ExternalLink size={15} /></a></p>
          <p className="hub-muted">Company email and applicant files use the shared connection managed by the owner. You do not need the owner’s or another recruiter’s password. Your personal connection only handles your calendar.</p>
        </section>
        <PersonalCalendarSetup key={member.email} member={member} refresh={refresh} />
      </>}
      {section === "team" && managesTeam && <><TeamAccess member={member} changed={changed} refresh={refresh} /><details className="hub-card hub-setup-details"><summary>Review reminders</summary><ReviewReminderSettings /></details></>}
      {section === "scorecards" && <section className="hub-card" id="scorecard-settings"><ScorecardTemplates jobs={jobs} /></section>}
      {section === "company" && owner && <CompanySettings member={member} refresh={refresh} changed={changed} jobs={jobs} onDeliveryActivity={onDeliveryActivity} />}
    </section>
  );
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
  return (
    <div className="hub-settings-stack hub-company-settings">
      <p className="hub-notice">
        Company setup is managed by the owner. This shared account sends recruiting emails and stores applicant files. Recruiters connect their own calendars under My setup.
        Changes in steps 2 and 3 take effect when you click Save settings.
      </p>
      <ResourceState loading={runtime.loading} error={runtime.error} retry={() => void runtime.reload()} />
      {runtime.data?.configured === false && <p className="hub-notice hub-error" role="alert">
        Google client setup is missing. An administrator must complete Advanced admin setup below, then click Refresh setup checks before connecting an account.
      </p>}
      {runtime.data?.hostingPlatform === "railway" && !runtime.data.backgroundEnabled && <p className="hub-notice hub-error" role="alert">
        Automatic email, calendar, and file processing is disabled. An administrator must enable it in Advanced admin setup before launch.
      </p>}
      {initial.queue.failed > 0 && <p className="hub-notice hub-error" role="alert">
        {initial.queue.failed} integration task(s) need attention. Open Delivery activity to review the error and retry safely.
      </p>}
      {onDeliveryActivity && <button className="hub-button secondary" type="button" onClick={onDeliveryActivity}>Open delivery activity</button>}
      <section className="hub-card">
        <div className="hub-section-heading compact">
          <div>
            <h3>1. Company email & applicant archive</h3>
            <p>
              The shared company account sends Gmail messages and saves applicant files to Drive. Each recruiter can connect a separate interview calendar under My setup.
            </p>
          </div>
          <Badge tone={initial.google.connected ? "success" : "warning"}>
            {initial.google.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <dl className="hub-connection-details">
          <div>
            <dt>Connected account</dt>
            <dd>{connectedAccount || "No active connection"}</dd>
          </div>
          <div><dt>Account allowed to connect</dt><dd>{initial.google.expectedSender || "Check Google connection setup"}</dd></div>
          <div>
            <dt>Applications</dt>
            <dd>
              <Badge tone={initial.applicationsEnabled ? "success" : "warning"}>
                {initial.applicationsEnabled
                  ? "Enabled"
                  : "Closed until launch checks pass"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>Scheduled work</dt>
            <dd>
              {initial.queue.pending} pending · {initial.queue.failed} failed
            </dd>
          </div>
        </dl>
        {initial.mailSync && (
          <p className="hub-muted">
            Email replies last checked:{" "}
            {initial.mailSync.lastCheckedAt
              ? displayDate(initial.mailSync.lastCheckedAt)
              : "Not checked yet"}
            .
          </p>
        )}
        {initial.mailSync?.lastError && (
          <p className="hub-notice hub-error" role="alert">
            Email reply sync: {initial.mailSync.lastError}
          </p>
        )}
        <div className="hub-button-row">
          <button
            className="hub-button secondary"
            onClick={() => void connect()}
            disabled={connection.busy || runtime.loading || runtime.data?.configured === false}
          >
            {connection.busy
              ? "Connecting…"
              : initial.google.connected
                ? "Reconnect Google Workspace"
                : "Connect Google Workspace"}{" "}
            <ExternalLink size={15} />
          </button>
          <button className="hub-text-button" type="button" onClick={() => void runtime.reload()} disabled={runtime.loading}>
            Refresh setup checks
          </button>
        </div>
        <Feedback error={connection.error} success={connection.success} />
        <p className="hub-muted">
          Choose {initial.google.expectedSender || "the configured recruiting account"} on the Google screen.
          This company connection is separate from each recruiter’s calendar. Leave it connected when adding recruiters; they use My setup with their own accounts.
        </p>
      </section>
      <form onSubmit={save} className="hub-company-settings-form">
        <fieldset className="hub-settings-stack" disabled={mutation.busy}>
          <section className="hub-card">
            <h3>2. Shared fallback interview calendar</h3>
            <p className="hub-muted">
              Use the connected account’s calendar now, or a calendar shared with that account.
              Confirm the hours below, save, then send a test interview from an applicant’s profile.
            </p>
            <button
              type="button"
              className="hub-button secondary"
              disabled={!connectedAccount}
              onClick={() => setCalendarId(connectedAccount)}
            >
              Use {connectedAccount || "connected account"} calendar
            </button>
            <p className="hub-muted">
              Recruiters normally connect their own calendar in My setup. This fallback is only used when the shared company calendar is selected for an interview. A calendar selection alone does not grant access.
              Active or unresolved interviews must be cancelled or reconciled before switching calendars.
            </p>
            <div className="hub-form-grid">
              <Field label="Interview calendar" hint="Usually the calendar owner’s email. For a shared calendar, copy its Calendar ID from Google Calendar → Settings → Integrate calendar.">
                <input
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  placeholder="For example sales@aicaseleads.com"
                />
              </Field>
              <Field
                label="Interview time zone"
                hint="Use an IANA time zone, for example America/Bogota."
              >
                <input
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  required
                />
              </Field>
              <Field label="Day starts (hour, 0–23)">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                  required
                />
              </Field>
              <Field label="Day ends (hour, 1–24)">
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                  required
                />
              </Field>
              <Field label="Interview length in minutes">
                <input
                  type="number"
                  min="15"
                  max="120"
                  step="5"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                />
              </Field>
            </div>
            <div
              className="hub-weekdays"
              role="group"
              aria-label="Interview days"
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, index) => (
                <label className="hub-checkbox" key={day}>
                  <input
                    type="checkbox"
                    checked={weekdays.includes(index)}
                    onChange={(e) =>
                      setWeekdays((current) =>
                        e.target.checked
                          ? [...current, index].sort()
                          : current.filter((value) => value !== index),
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            <label className="hub-checkbox">
              <input
                type="checkbox"
                checked={remindersEnabled}
                aria-describedby="interview-reminder-help"
                onChange={(e) => setRemindersEnabled(e.target.checked)}
              />
              Send interview reminders through Gmail
            </label>
            <p className="hub-muted" id="interview-reminder-help">
              Off by default. When enabled, reminders are scheduled 24 hours
              and 1 hour before a confirmed future booking. Reminders are
              skipped for pending, cancelled, or replaced bookings.
            </p>
            <Badge
              tone={initial.scheduling?.configured ? "success" : "warning"}
            >
              {initial.scheduling?.configured
                ? "Calendar and availability saved"
                : "Save calendar and availability to enable invitations"}
            </Badge>
            <p className="hub-muted">Saved settings do not verify access. A completed test booking confirms calendar access and Meet creation; check Delivery activity for delivery errors.</p>
          </section>
          <section className="hub-card">
            <h3>3. Choose the shared applicant folder</h3>
            <p className="hub-muted">Open Google Drive, choose a shared company folder or Shared Drive, and paste its link below. Give the connected recruiting account permission to add files, and give hiring managers access.</p>
            <Field
              label="Shared Google Drive folder"
              hint="Paste the folder link from your browser, or enter its folder ID. The folder stays private to people you share it with."
            >
              <input
                value={driveRootId}
                onChange={(e) => setDriveRootId(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
              />
            </Field>
            <div className="hub-button-row">
              <Badge tone={initial.google.driveRootId ? "success" : "warning"}>
                {initial.google.driveRootId ? "Folder saved" : "Choose a folder"}
              </Badge>
              {savedDriveId && <a className="hub-button secondary" href={"https://drive.google.com/drive/folders/" + encodeURIComponent(savedDriveId)} target="_blank" rel="noopener noreferrer">
                Open saved folder <ExternalLink size={15} />
              </a>}
            </div>
            <p className="hub-muted">
              Files are organized automatically: Recruiting → Job → Location → Posting → Applicant.
              Earlier postings remain stored when you hire again. Each application has a separate folder.
              A saved folder is not proof of access: check a test application’s Drive link and Delivery activity to confirm files arrived.
              Temporary Drive failures do not lose accepted applications.
            </p>
          </section>
          <details className="hub-card hub-setup-details"><summary>Default rejection email</summary>
            <h3>Default rejection email for new jobs</h3>
            <Field label="Approved template">
              <textarea
                rows={7}
                value={rejectionTemplate}
                onChange={(e) => setRejectionTemplate(e.target.value)}
              />
            </Field>
            <p className="hub-muted">
              New roles use this default. Existing roles keep their approved
              message, which you can edit in Jobs. Individual and
              automatic rejection rules must be explicitly approved.
            </p>
          </details>
          <div className="hub-card hub-settings-save" role="group" aria-label="Save company settings">
            <button
              className="hub-button"
              type="submit"
              disabled={mutation.busy}
            >
              {mutation.busy ? "Saving settings…" : "Save settings"}
            </button>
            <p className="hub-muted">Saves the shared calendar, applicant folder, and default rejection email above.</p>
            <Feedback error={validationError || mutation.error} success={validationError ? "" : mutation.success} />
          </div>
        </fieldset>
      </form>
      <details className="hub-card hub-setup-details"><summary>AI connection</summary><AiReviewSettings /></details>
      <details className="hub-card hub-setup-details">
        <summary>Advanced admin setup</summary>
        <p className="hub-muted">Only needed when installing the app or changing its Google client or background processing. Day-to-day hiring uses the three steps above.</p>
        <GoogleConfiguration />
        <SchedulerSetup />
      </details>
      {initial.accessAudit && <details className="hub-card hub-setup-details"><summary>Recent access changes</summary><h3>Access history</h3><p className="hub-muted">Configuration changes record who made them and the previous and updated values. Most recent 50 events.</p>{initial.accessAudit.length ? initial.accessAudit.map((event) => <article key={event.id} className="hub-history-item"><strong>{event.type} · {event.actor}</strong><small>{displayDate(event.createdAt)}</small><details><summary>Review recorded change</summary><pre className="hub-preserve">{JSON.stringify({before:event.before,after:event.after},null,2)}</pre></details></article>) : <p className="hub-muted">No access changes recorded yet.</p>}</details>}
    </div>
  );
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
                  <th scope="col">Last error</th>
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
                        {task.status}
                      </Badge>
                    </td>
                    <td>{task.attempts}</td>
                    <td>{displayDate(task.updatedAt)}</td>
                    <td className="hub-task-error">{task.lastError || "—"}</td>
                    <td>
                      {task.status === "uncertain" && task.kind === "calendar" ? (
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
