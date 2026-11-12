"use client";
import { useEffect, useRef, useState } from "react";
import { useHubMutation, useHubResource } from "./api";
import { Feedback, Field, ResourceState } from "./shared";

export type JobTeamDraft = {
  members: string[];
  replyTo: string | null;
  notifyNewApplications: boolean;
  notifyAssessmentSubmissions: boolean;
  notifyReplies: boolean;
  notifyOverdueReviews: boolean;
};
export type JobTeamData = {
  config: (JobTeamDraft & { revision: number }) | null;
  staff: { email: string; role: string }[];
  sender: string;
};
export const emptyJobTeam: JobTeamDraft = {
  members: [], replyTo: null, notifyNewApplications: true,
  notifyAssessmentSubmissions: true, notifyReplies: true, notifyOverdueReviews: true,
};

export function useJobTeam(jobId?: string) {
  const resource = useHubResource<JobTeamData>("/api/job-team" + (jobId ? "?jobId=" + encodeURIComponent(jobId) : ""));
  const [draft, setDraft] = useState<JobTeamDraft | null>(null);
  useEffect(() => {
    if (!resource.data || draft !== null) return;
    const { config } = resource.data;
    queueMicrotask(() => setDraft(config ? { members: config.members, replyTo: config.replyTo,
      notifyNewApplications: config.notifyNewApplications,
      notifyAssessmentSubmissions: config.notifyAssessmentSubmissions,
      notifyReplies: config.notifyReplies, notifyOverdueReviews: config.notifyOverdueReviews,
    } : structuredClone(emptyJobTeam)));
  }, [resource.data, draft]);
  return { resource, draft, setDraft };
}

export function JobTeamFields({ data, value, change, readOnly = false }: {
  data: JobTeamData; value: JobTeamDraft; change: (value: JobTeamDraft) => void; readOnly?: boolean;
}) {
  const active = new Set(data.staff.map(person => person.email));
  const unavailable = value.members.filter(email => !active.has(email));
  function toggle(email: string, checked: boolean) {
    const members = checked ? [...value.members, email] : value.members.filter(item => item !== email);
    change({ ...value, members, replyTo: value.replyTo && members.includes(value.replyTo) ? value.replyTo : null });
  }
  return <div className="hub-job-team-fields">
    <p>Assign the hiring team for this job. Only the selected team receives its email alerts.</p>
    <fieldset disabled={readOnly} className="hub-team-member-picker">
      <legend>Hiring team for this job</legend>
      {data.staff.map(person => <label className="hub-checkbox" key={person.email}>
        <input type="checkbox" checked={value.members.includes(person.email)} onChange={event => toggle(person.email, event.target.checked)} />
        <span>{person.email}<small className="hub-muted">{person.role === "admin" ? "Manager" : "Recruiter"}</small></span>
      </label>)}
      {!data.staff.length && <p>No active team members are available yet.</p>}
      {unavailable.map(email => <label className="hub-checkbox" key={email}>
        <input type="checkbox" checked onChange={() => toggle(email, false)} />
        <span>{email}<small className="hub-muted">Access removed — will not receive emails. Uncheck to remove.</small></span>
      </label>)}
    </fieldset>
    <p className="hub-muted">Missing someone? Add them in Settings → Team.</p>
    {!value.members.length && <p className="hub-notice">No team members selected. This job will not send team alerts. Applications still appear in the dashboard.</p>}
    <Field label="Default reply contact" hint="An active owner, manager or recruiter with Gmail connected in My calendar & email. Used when the sender cannot handle replies.">
      <select disabled={readOnly} value={value.replyTo || ""} onChange={event => change({...value,replyTo:event.target.value || null})}>
        <option value="">Choose a team member (or use the application assignee)</option>
        {value.members.filter(email=>active.has(email)).map(email=><option key={email} value={email}>{email}</option>)}
      </select>
    </Field>
    <details className="hub-team-alert-settings">
      <summary>Email notification settings</summary>
    <fieldset disabled={readOnly} className="hub-team-alert-picker">
      <legend>Email this team about</legend>
      {([
        ["notifyNewApplications", "New applications"],
        ["notifyAssessmentSubmissions", "Submitted assessments"],
        ["notifyReplies", "Applicant replies received in the connected mailbox"],
        ["notifyOverdueReviews", "Overdue reviews (when daily reminders are enabled in Settings)"],
      ] as const).map(([key, label]) => <label className="hub-checkbox" key={key}>
        <input type="checkbox" checked={value[key]} onChange={event => change({ ...value, [key]: event.target.checked })} />
        <span>{label}</span>
      </label>)}
    </fieldset>
    <p className="hub-muted">Each sender connects Gmail in My calendar & email. Saving this team does not email previous applicants.</p>
    </details>
    <details>
      <summary>How candidate replies work</summary>
      <p className="hub-muted">Automatic receipts and screening rejections use no-reply. Manual messages direct replies to the sender. Interview invitations use the selected interviewer's connected Gmail for the sender, CC and Reply-To.</p>
    </details>
  </div>;
}

export function JobTeamPanel({ jobId, title, admin, close }: { jobId: string; title: string; admin: boolean; close: () => void }) {
  const { resource, draft, setDraft } = useJobTeam(jobId);
  const mutation = useHubMutation();
  const [revision, setRevision] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="hub-card hub-job-team-panel" aria-label={`Hiring team for ${title}`}>
    <div className="hub-section-heading"><div><h3 ref={heading} tabIndex={-1}>Hiring team · {title}</h3><p>People and email alerts for this posting.</p></div>
      <button type="button" className="hub-button secondary" onClick={close} disabled={mutation.busy}>Close hiring team</button></div>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
    {resource.data && draft && <form onSubmit={async event => {
      event.preventDefault();
      const saved = await mutation.run<JobTeamData>("/api/job-team", "PUT", { jobId, expectedRevision: revision ?? resource.data!.config?.revision ?? 0, ...draft }, "Hiring team saved. Future alerts use these recipients.");
      if (saved) setRevision(saved.config?.revision ?? 0);
    }}>
      <fieldset disabled={mutation.busy}><JobTeamFields data={resource.data} value={draft} change={value => {setDraft(value); mutation.clear();}} readOnly={!admin} /></fieldset>
      <Feedback error={mutation.error} success={mutation.success} />
      {admin ? <button className="hub-button" disabled={mutation.busy || resource.loading}>Save hiring team</button> : <p className="hub-muted">Ask a manager to change this job’s team.</p>}
    </form>}
  </section>;
}
