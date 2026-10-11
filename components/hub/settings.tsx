"use client";
import { useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  displayDate,
  safeNavigation,
  useHubMutation,
  useHubResource,
} from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { Member, Settings, Task } from "./types";
import { GoogleConfiguration } from "./google-setup";
import { SchedulerSetup } from "./scheduler-setup";
import { driveFolderId } from "./drive-folder";
import { AiReviewSettings } from "./ai-review";

export function HubSettings({
  member,
  refresh,
  changed,
}: {
  member: Member;
  refresh: number;
  changed: () => void;
}) {
  const resource = useHubResource<Settings>("/api/hub/settings", refresh);
  return (
    <section aria-labelledby="settings-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">ADMINISTRATION</p>
          <h2 id="settings-title">Team & settings</h2>
          <p>
            Follow the three connection steps, then invite your hiring team.
          </p>
        </div>
      </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data && !resource.loading && (
        <SettingsForm
          key={JSON.stringify(resource.data)}
          initial={resource.data}
          member={member}
          changed={() => {
            changed();
            void resource.reload();
          }}
        />
      )}
    </section>
  );
}
function SettingsForm({
  initial,
  member,
  changed,
}: {
  initial: Settings;
  member: Member;
  changed: () => void;
}) {
  const [members, setMembers] = useState<Member[]>(() => {
      const active = initial.members.filter((value) => value.active !== false);
      return active.some(
        (value) => value.email.toLowerCase() === member.email.toLowerCase(),
      )
        ? active
        : [{ email: member.email, role: "admin" }, ...active];
    }),
    [calendarId, setCalendarId] = useState(initial.google.calendarId || ""),
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
        members: members.map((value) => ({
          email: value.email.trim(),
          role: value.role,
        })),
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
  function updateMember(index: number, update: Partial<Member>) {
    setMembers((current) =>
      current.map((value, i) =>
        i === index ? { ...value, ...update } : value,
      ),
    );
  }
  return (
    <>
      <p className="hub-notice">
        Start here: connect Google, choose the interview calendar, and choose where applicant files are saved.
        Changes in steps 2 and 3 take effect when you click Save team & settings.
      </p>
      <ResourceState loading={runtime.loading} error={runtime.error} retry={() => void runtime.reload()} />
      {runtime.data?.configured === false && <p className="hub-notice hub-error" role="alert">
        Google client setup is missing. An administrator must complete Advanced admin setup below, then click Refresh setup checks before connecting an account.
      </p>}
      {runtime.data?.hostingPlatform === "railway" && !runtime.data.backgroundEnabled && <p className="hub-notice hub-error" role="alert">
        Automatic email, calendar, and file processing is disabled. An administrator must enable it in Advanced admin setup before launch.
      </p>}
      {initial.queue.failed > 0 && <p className="hub-notice hub-error" role="alert">
        {initial.queue.failed} integration task(s) need attention. Open Integration tasks to review the error and retry safely.
      </p>}
      <section className="hub-card">
        <div className="hub-section-heading compact">
          <div>
            <h3>1. Connect your recruiting Google account</h3>
            <p>
              One shared connection sends recruiting emails, creates interviews with Meet, and saves applicant files.
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
        <Feedback error={connection.error} success={connection.success} />
        <p className="hub-muted">
          Choose {initial.google.expectedSender || "the configured recruiting account"} on the Google screen.
          Your dashboard login is separate. To switch the recruiting account to Maria, an administrator must first change the allowed account in server configuration, then Maria must authorize Google here. This button cannot change that account restriction.
        </p>
      </section>
      <form onSubmit={save}>
        <fieldset disabled={mutation.busy}>
          <section className="hub-card">
            <h3>2. Choose the interview calendar</h3>
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
              For Maria’s calendar, she can share it with {connectedAccount || "the connected recruiting account"} and grant permission to change events. Then enter her calendar ID below. A calendar selection alone does not grant access.
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
            <p className="hub-muted">Saved settings do not verify access. A completed test booking confirms calendar access and Meet creation; check Integration tasks for delivery errors.</p>
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
              Files are organized automatically: Recruiting → Job → Location → Batch → Applicant.
              Earlier batches remain stored when you hire again. Each application has a separate folder.
              A saved folder is not proof of access: check a test application’s Drive link and Integration tasks to confirm files arrived.
              Temporary Drive failures do not lose accepted applications.
            </p>
          </section>
          <section className="hub-card">
            <div className="hub-section-heading compact">
              <div>
                <h3>Team access</h3>
                <p>
                  Administrators manage configuration. Recruiters can operate
                  hiring records.
                </p>
              </div>
              <button
                type="button"
                className="hub-button secondary"
                onClick={() =>
                  setMembers((current) => [
                    ...current,
                    { email: "", role: "recruiter" },
                  ])
                }
              >
                <Plus size={16} /> Add teammate
              </button>
            </div>
            <div className="hub-editor-list">
              {members.map((value, index) => (
                <div className="hub-member-row" key={index}>
                  <Field label={"Teammate " + (index + 1) + " email"}>
                    <input
                      required
                      type="email"
                      value={value.email}
                      onChange={(e) =>
                        updateMember(index, { email: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Access level">
                    <select
                      value={value.role}
                      onChange={(e) =>
                        updateMember(index, {
                          role: e.target.value as Member["role"],
                        })
                      }
                    >
                      <option value="admin">Administrator — full access</option>
                      <option value="recruiter">
                        Recruiter — hiring operations
                      </option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="hub-icon-button"
                    disabled={
                      value.email.toLowerCase() === member.email.toLowerCase()
                    }
                    onClick={() =>
                      setMembers((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                    aria-label={
                      "Remove " + (value.email || "teammate " + (index + 1))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            <p className="hub-muted">
              Your owner account keeps its server-configured administrative
              access. Teammates sign in with their own approved account.
            </p>
          </section>

          <section className="hub-card">
            <h3>Default rejection email for new roles</h3>
            <Field label="Approved template">
              <textarea
                rows={7}
                value={rejectionTemplate}
                onChange={(e) => setRejectionTemplate(e.target.value)}
              />
            </Field>
            <p className="hub-muted">
              New roles use this default. Existing roles keep their approved
              message, which you can edit in Jobs & batches. Individual and
              automatic rejection rules must be explicitly approved.
            </p>
          </section>
          <div className="hub-sticky-save">
            <button
              className="hub-button"
              type="submit"
              disabled={mutation.busy}
            >
              {mutation.busy ? "Saving settings…" : "Save team & settings"}
            </button>
            <Feedback error={validationError || mutation.error} success={validationError ? "" : mutation.success} />
          </div>
        </fieldset>
      </form>
      <AiReviewSettings />
      <details className="hub-card hub-setup-details">
        <summary>Advanced admin setup</summary>
        <p className="hub-muted">Only needed when installing the app or changing its Google client or background processing. Day-to-day hiring uses the three steps above.</p>
        <GoogleConfiguration />
        <SchedulerSetup />
      </details>
      {initial.accessAudit && <section className="hub-card"><h3>Recent access changes</h3><p className="hub-muted">Configuration changes record who made them and the previous and updated values. Most recent 50 events.</p>{initial.accessAudit.length ? initial.accessAudit.map((event) => <article key={event.id} className="hub-history-item"><strong>{event.type} · {event.actor}</strong><small>{displayDate(event.createdAt)}</small><details><summary>Review recorded change</summary><pre className="hub-preserve">{JSON.stringify({before:event.before,after:event.after},null,2)}</pre></details></article>) : <p className="hub-muted">No access changes recorded yet.</p>}</section>}
    </>
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
          <h2 id="tasks-title">Integration tasks</h2>
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
