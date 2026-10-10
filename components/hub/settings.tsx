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
            Manage authorized reviewers, communication, scheduling, and Drive
            archival.
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
  async function save(e: React.FormEvent) {
    e.preventDefault();
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
        driveRootId: driveRootId.trim(),
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
      <GoogleConfiguration />
      <SchedulerSetup />
      <section className="hub-card">
        <div className="hub-section-heading compact">
          <div>
            <h3>Google Workspace</h3>
            <p>
              Email, Calendar, Meet, and Drive use the authorized company
              connection.
            </p>
          </div>
          <Badge tone={initial.google.connected ? "success" : "warning"}>
            {initial.google.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <dl className="hub-connection-details">
          <div>
            <dt>Recruiting sender</dt>
            <dd>{initial.google.sender || "Not configured"}</dd>
          </div>
          <div><dt>Account to authorize</dt><dd>{initial.google.expectedSender || "mariam@aicaseleads.com"}</dd></div>
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
          disabled={connection.busy}
        >
          {connection.busy
            ? "Connecting…"
            : initial.google.connected
              ? "Reconnect Google Workspace"
              : "Connect Google Workspace"}{" "}
          <ExternalLink size={15} />
        </button>
        <Feedback error={connection.error} success={connection.success} />
        <p className="hub-muted">
          Configure the Google OAuth client above before connecting. Saved
          client secrets are not returned to this page.
        </p>
      </section>
      <form onSubmit={save}>
        <fieldset disabled={mutation.busy}>
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
            <h3>Calendar & booking availability</h3>
            <p className="hub-muted">
              Save the actual recruiting calendar and interview availability
              before sending invitations.
            </p>
            <div className="hub-form-grid">
              <Field label="Recruiting calendar ID">
                <input
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  placeholder="Calendar ID from Google Calendar settings"
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
                ? "Booking availability configured"
                : "Save availability to enable interview invitations"}
            </Badge>
          </section>
          <section className="hub-card">
            <h3>Drive archival</h3>
            <Field
              label="Recruiting root folder ID"
              hint="Use the shared company folder where Recruiting / Role / Candidate–Application ID should be archived."
            >
              <input
                value={driveRootId}
                onChange={(e) => setDriveRootId(e.target.value)}
                placeholder="Folder ID from the Google Drive URL"
              />
            </Field>
            <p className="hub-muted">
              Each application gets its own archive. Temporary Drive failures
              remain visible in integration tasks and do not lose an accepted
              application.
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
              message, which you can edit in Roles & forms. Individual and
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
            <Feedback error={mutation.error} success={mutation.success} />
          </div>
        </fieldset>
      </form>
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
