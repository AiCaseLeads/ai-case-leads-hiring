"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Search } from "lucide-react";
import {
  displayAnswer,
  displayDate,
  useHubMutation,
  useHubResource,
} from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import { ReusableScorecard, useScorecardDraft } from "./scorecards";
import { CandidateEvidence, useEvidenceDraft } from "./ai-review";
import { MatchScore, JobMatchSetup, CandidateMatch } from "./ai-match";
import { InterviewerChoice } from "./personal-calendar";
import { jobGroup, jobLocation } from "./job-organization";
import { applicationsCsv, downloadApplication, downloadFile } from "./export";
import {
  stages,
  type ApplicationDetail,
  type ApplicationList,
  type ApplicationSummary,
  type HubJob,
  type ReviewerGrade,
} from "./types";

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
  return value === "pass" ? "success" : value === "fail" ? "danger" : "warning";
}
export function CandidateTable({
  items,
  select,
  selected,
  toggle,
}: {
  items: ApplicationSummary[];
  select: (id: string) => void;
  selected?: string[];
  toggle?: (id: string) => void;
}) {
  return (
    <div className="hub-table-wrap">
      <table className="hub-table hub-applications-table" role="table" aria-label="Applications">
        <thead role="rowgroup">
          <tr role="row">
            {toggle && (
              <th scope="col" role="columnheader">
                <span className="sr-only">Select candidate</span>
              </th>
            )}
            <th scope="col" role="columnheader">Candidate</th>
            <th scope="col" role="columnheader">Role</th>
            <th scope="col" role="columnheader">Stage</th>
            <th scope="col" role="columnheader">Qualification</th>
            <th scope="col" role="columnheader">AI job match</th>
            <th scope="col" role="columnheader">Reviewer grade</th>
            <th scope="col" role="columnheader">Owner</th>
            <th scope="col" role="columnheader">Applied</th>
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
                <button
                  className="hub-text-button hub-candidate-name"
                  onClick={() => select(item.id)}
                >
                  {item.name || "Unnamed applicant"}
                </button>
                <span className="hub-secondary-line">{item.email}</span>
                {item.duplicateEmail && <Badge tone="warning">Shared email · {item.duplicateApplicationCount || 2} applications</Badge>}
              </td>
              <td role="cell" data-label="Role">{item.jobTitle}</td>
              <td role="cell" data-label="Stage">
                <Badge>{item.stage}</Badge>
              </td>
              <td role="cell" data-label="Qualification">
                <Badge tone={qualificationTone(item.qualification)}>
                  {item.qualification === "review"
                    ? "Needs review"
                    : item.qualification === "pass" ? "Requirements met" : "Requirement not met"}
                </Badge>
              </td>
              <td role="cell" data-label="AI job match"><MatchScore match={item.aiMatch} /></td>
              <td role="cell" data-label="Reviewer grade"><GradeSummary grade={item.grade} /></td>
              <td role="cell" data-label="Owner">{item.assignee || "Unassigned"}</td>
              <td role="cell" data-label="Applied" className="hub-nowrap">{displayDate(item.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Candidates({
  jobs,
  refresh,
  changed,
  reviewerEmail,
  initialStage = "",
  initialJobId = "",
  initialFilter,
  initialPage = 1,
  onSelect,
  onFilterChange,
}: {
  jobs: HubJob[];
  refresh: number;
  changed: () => void;
  reviewerEmail: string;
  initialStage?: string;
  initialJobId?: string;
  initialFilter?: string;
  initialPage?: number;
  onSelect?: (id: string) => void;
  onFilterChange?: (filter: string, page: number) => void;
}) {
  const initial = new URLSearchParams(initialFilter);
  if (initialStage) initial.set("stage", initialStage);
  if (initialJobId) initial.set("jobId", initialJobId);
  else {initial.delete("jobId"); initial.delete("grade"); initial.delete("sort");}
  if (!initialStage) initial.delete("stage");
  const [q, setQ] = useState(initial.get("q") || ""),
    [jobId, setJobId] = useState(initialJobId),
    [stage, setStage] = useState(initialStage),
    [assignee, setAssignee] = useState(initial.get("assignee") || ""),
    [qualification, setQualification] = useState(initial.get("qualification") || ""),
    [grade, setGrade] = useState(initial.get("grade") || ""),
    [sort, setSort] = useState(initial.get("sort") || ""),
    [duplicate, setDuplicate] = useState(initial.get("duplicate") === "true"),
    [page, setPage] = useState(initialPage),
    [filter, setFilter] = useState(initial.toString()),
    [selected, setSelected] = useState<string[]>([]),
    [detailId, setDetailId] = useState<string | null>(null);
  const [queues, setQueues] = useState<{name: string; filter: string}[]>([]),
    [queueName, setQueueName] = useState(""), [queueMessage, setQueueMessage] = useState("");
  const queueStorage = "aicl:reviewqueues:" + reviewerEmail.toLowerCase();
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(queueStorage) || "[]");
      if (Array.isArray(saved)) queueMicrotask(() => setQueues(saved.filter((item) => item && typeof item.name === "string" && typeof item.filter === "string").slice(0, 20)));
    } catch { /* A queue never affects authoritative hiring records. */ }
  }, [queueStorage]);
  const [bulkAction, setBulkAction] = useState("stage"),
    [bulkStage, setBulkStage] = useState("Screening"),
    [bulkAssignee, setBulkAssignee] = useState(""),
    [reason, setReason] = useState(""),
    [approve, setApprove] = useState(false);
  const path = "/api/hub/applications?" + filter + "&page=" + page;
  const resource = useHubResource<ApplicationList & { pageSize?: number }>(
      path,
      refresh,
    ),
    mutation = useHubMutation();
  const visibleRevisions = resource.data?.items.map(item => `${item.id}:${item.revision}`).join("|");
  useEffect(() => {
    // A previous selection or rejection approval must not carry over to changed records.
    queueMicrotask(() => {setSelected([]); setApprove(false);});
  }, [refresh, visibleRevisions]);
  function filterSubmit(e: React.FormEvent) {
    e.preventDefault();
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (jobId) search.set("jobId", jobId);
    if (stage) search.set("stage", stage);
    if (assignee) search.set("assignee", assignee);
    if (qualification) search.set("qualification", qualification);
    if (jobId && grade) search.set("grade", grade);
    if (jobId && sort) search.set("sort", sort);
    if (duplicate) search.set("duplicate", "true");
    onFilterChange?.(search.toString(), 1);
    setFilter(search.toString());
    setPage(1);
    setSelected([]);
  }
  function applySavedQueue(value: string) {
    const params = new URLSearchParams(value);
    setQ(params.get("q") || ""); setJobId(params.get("jobId") || ""); setStage(params.get("stage") || ""); setAssignee(params.get("assignee") || "");
    setQualification(params.get("qualification") || ""); setGrade(params.get("grade") || ""); setSort(params.get("sort") || ""); setDuplicate(params.get("duplicate") === "true");
    onFilterChange?.(value, 1);
    setFilter(value); setPage(1); setSelected([]);
  }
  function saveQueue() {
    if (!queueName.trim()) return;
    const next = [...queues.filter((queue) => queue.name !== queueName.trim()), {name:queueName.trim().slice(0,80),filter}].slice(-20);
    try { localStorage.setItem(queueStorage, JSON.stringify(next)); setQueues(next); setQueueName(""); setQueueMessage("Review queue saved in this browser only."); }
    catch { setQueueMessage("This browser could not save your queue. Your filters are still active."); }
  }
  async function exportApplications() {
    const result = await mutation.run<{items:ApplicationSummary[];total:number;truncated:boolean;limit:number}>("/api/hub/applications-export?" + filter, "GET", undefined, "Application export prepared.");
    if (result) {
      downloadFile(applicationsCsv(result.items), "applications.csv", "text/csv;charset=utf-8");
      setQueueMessage(result.truncated ? `Exported the first ${result.limit} of ${result.total} matching applications. Narrow your filters to export the rest.` : `Exported ${result.items.length} matching applications.`);
    }
  }
  async function applyBulk(e: React.FormEvent) {
    e.preventDefault();
    if (
      selected.length === 0 ||
      selected.length > 100 ||
      (bulkAction === "reject" && !approve)
    )
      return;
    const result = await mutation.run(
      "/api/hub/bulk",
      "POST",
      {
        ids: selected,
        expectedRevisions: Object.fromEntries((resource.data?.items || []).filter((item) => selected.includes(item.id)).map((item) => [item.id, item.revision])),
        action: bulkAction,
        ...(bulkAction === "stage"
          ? { stage: bulkStage }
          : bulkAction === "assign"
            ? { assignee: bulkAssignee.trim() || null }
            : { reason }),
      },
      "Bulk action saved. Candidate records have been updated.",
    );
    if (result !== undefined) {
      setSelected([]);
      setApprove(false);
      changed();
      void resource.reload();
    }
  }
  if (detailId)
    return (
      <CandidateDetail
        key={detailId}
        id={detailId}
        back={() => setDetailId(null)}
        changed={changed}
      />
    );
  return (
    <section aria-labelledby="candidates-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">RECRUITER WORKSPACE</p>
          <h2 id="candidates-title">Applications</h2>
          <p>
            Review each application, record decisions, and initiate the next
            step.
          </p>
        </div>
        <div className="hub-button-row"><span className="hub-count">
          {resource.data ? resource.data.total + " applications" : ""}
        </span><button type="button" className="hub-button secondary" disabled={mutation.busy || !resource.data} onClick={() => void exportApplications()}><Download size={16} /> Export filtered applications</button></div>
      </div>
      <form className="hub-card" onSubmit={filterSubmit}>
        <div className="hub-filter-grid">
          <Field label="Search"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Name or email" type="search" /></Field>
          <Field label="Job posting"><select value={jobId} onChange={e=>{setJobId(e.target.value);setGrade("");setSort("");}}><option value="">All job postings</option>{jobs.map(job=><option key={job.id} value={job.id}>{jobGroup(job)} · {job.location || jobLocation(job)} · {job.status} · /{job.slug}</option>)}</select></Field>
          <Field label="Stage"><select value={stage} onChange={e=>setStage(e.target.value)}><option value="">All stages</option>{stages.map(value=><option key={value}>{value}</option>)}</select></Field>
          <Field label="Order" hint={!jobId ? "Choose a posting to compare job matches." : undefined}><select value={sort} disabled={!jobId} onChange={e=>setSort(e.target.value)}><option value="">Newest applications</option><option value="ai_match_desc">Highest AI match first</option><option value="grade_desc">Highest reviewer grade first</option></select></Field>
        </div>
        <details>
          <summary>More filters{[qualification,grade,assignee,duplicate].filter(Boolean).length ? ` · ${[qualification,grade,assignee,duplicate].filter(Boolean).length} selected` : ""}</summary>
          <div className="hub-filter-grid">
            <Field label="Qualification rules"><select value={qualification} onChange={e=>setQualification(e.target.value)}><option value="">All qualification results</option><option value="pass">Requirements met</option><option value="review">Needs review</option><option value="fail">Requirement not met</option></select></Field>
            <Field label="Reviewer grades" hint={!jobId ? "Choose a job posting to compare reviewer grades." : "Qualification and reviewer grade are separate."}><select value={grade} disabled={!jobId} onChange={e=>setGrade(e.target.value)}><option value="">Graded and ungraded</option><option value="reviewed">Graded applications</option><option value="ungraded">Ungraded applications</option></select></Field>
            <Field label="Assigned to"><input value={assignee} onChange={e=>setAssignee(e.target.value)} type="email" placeholder="Reviewer email" /></Field>
            <label className="hub-checkbox"><input type="checkbox" checked={duplicate} onChange={e=>setDuplicate(e.target.checked)} /> Shared-email applications</label>
          </div>
        </details>
        <div className="hub-button-row"><button className="hub-button" type="submit"><Search size={16} /> Apply filters</button><button className="hub-button secondary" type="button" onClick={()=>{setQ("");setJobId("");setStage("");setAssignee("");setQualification("");setGrade("");setSort("");setDuplicate(false);onFilterChange?.("",1);setFilter("");setPage(1);setSelected([]);}}>Clear filters</button></div>
      </form>
      {new URLSearchParams(filter).get("jobId") && <JobMatchSetup key={new URLSearchParams(filter).get("jobId")} jobId={new URLSearchParams(filter).get("jobId")!} changed={()=>void resource.reload()}/> }
      <details className="hub-card hub-review-queues">
        <summary>Saved review queues · this browser only</summary><p className="hub-muted">These filters stay in this browser for your account. Apply filters above before saving a queue; candidate records remain private in the hiring hub.</p>
        <div className="hub-button-row">{queues.map((queue) => <button key={queue.name} type="button" className="hub-button secondary" onClick={() => applySavedQueue(queue.filter)}>{queue.name}</button>)}</div>
        <div className="hub-button-row"><Field label="Name this review queue"><input value={queueName} maxLength={80} onChange={(e) => setQueueName(e.target.value)} placeholder="Engineer · needs review" /></Field><button type="button" className="hub-button secondary" disabled={!queueName.trim()} onClick={saveQueue}>Save current filters</button></div>
      </details>
      <p className="hub-muted">CSV export includes up to 1,000 matching application summaries; files and assessment answers remain in each candidate record.</p>
      {queueMessage && <p role="status">{queueMessage}</p>}<Feedback error={mutation.error} success={mutation.success} />
      {new URLSearchParams(filter).get("sort") === "grade_desc" && <p className="hub-notice">Comparing applications for one role. Grades use the latest overall score from each reviewer, weighted equally. Active graded applications come first, followed by active ungraded applications and closed outcomes. Qualification rules do not change the grade.</p>}
      {new URLSearchParams(filter).get("sort") === "ai_match_desc" && <p className="hub-notice">Comparing evidence against the same job requirements. Current completed AI reviews sort highest first; unreadable, pending and outdated reviews stay unscored. AI match is separate from qualification rules and human grades.</p>}
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {!resource.loading && resource.data && (
        <>
          {resource.data.items.length ? (
            <CandidateTable
              items={resource.data.items}
              select={onSelect || setDetailId}
              selected={selected}
              toggle={(id) =>
                setSelected((current) =>
                  current.includes(id)
                    ? current.filter((value) => value !== id)
                    : current.length < 100
                      ? [...current, id]
                      : current,
                )
              }
            />
          ) : (
            <EmptyState title="No applications in this view">
              <p>
                New accepted applications appear here. Try another filter if
                records already exist.
              </p>
            </EmptyState>
          )}
          <div className="hub-pagination">
            <button
              className="hub-button secondary"
              disabled={page <= 1}
              onClick={() => {
                onFilterChange?.(filter, page - 1);
                setPage((value) => value - 1);
                setSelected([]);
              }}
            >
              Previous
            </button>
            <span>
              Page {page} · {resource.data.total} total
            </span>
            <button
              className="hub-button secondary"
              disabled={
                resource.data.items.length === 0 ||
                page * (resource.data.pageSize || 25) >= resource.data.total
              }
              onClick={() => {
                onFilterChange?.(filter, page + 1);
                setPage((value) => value + 1);
                setSelected([]);
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
      {selected.length > 0 && (
        <form className="hub-bulk" onSubmit={applyBulk}>
          <strong>{selected.length} selected</strong>
          <Field label="Bulk action">
            <select
              value={bulkAction}
              onChange={(e) => {
                setBulkAction(e.target.value);
                setApprove(false);
              }}
            >
              <option value="stage">Move stage</option>
              <option value="assign">Assign reviewer</option>
              <option value="reject">Reject applications</option>
            </select>
          </Field>
          {bulkAction === "stage" && (
            <Field label="Stage">
              <select
                value={bulkStage}
                onChange={(e) => setBulkStage(e.target.value)}
              >
                {stages
                  .filter((s) => s !== "Rejected")
                  .map((s) => (
                    <option key={s}>{s}</option>
                  ))}
              </select>
            </Field>
          )}
          {bulkAction === "assign" && (
            <Field label="Reviewer email">
              <input
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                type="email"
                placeholder="Blank to unassign"
              />
            </Field>
          )}
          {bulkAction === "reject" && (
            <>
              <Field label="Rejection reason">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </Field>
              <label className="hub-checkbox">
                <input
                  type="checkbox"
                  checked={approve}
                  onChange={(e) => setApprove(e.target.checked)}
                  required
                />{" "}
                I approve these rejections and their rejection emails.
              </label>
            </>
          )}
          <button
            className="hub-button"
            type="submit"
            disabled={mutation.busy || (bulkAction === "reject" && !approve)}
          >
            {mutation.busy ? "Applying…" : "Apply to selected"}
          </button>
          <button
            className="hub-text-button"
            type="button"
            onClick={() => setSelected([])}
          >
            Clear selection
          </button>
          <Feedback error={mutation.error} success={mutation.success} />
        </form>
      )}
    </section>
  );
}
export function CandidateDetail({
  id,
  back,
  changed,
}: {
  id: string;
  back: () => void;
  changed: () => void;
}) {
  const resource = useHubResource<ApplicationDetail>(
      "/api/hub/applications/" + encodeURIComponent(id),
    ),
    mutation = useHubMutation();
  const [section, setSection] = useState<"application" | "review" | "activity">("application");
  const [action, setAction] = useState("note"),
    [stage, setStage] = useState("Screening"),
    [text, setText] = useState(""),
    [assignee, setAssignee] = useState(""),
    [reason, setReason] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [score, setScore] = useState(""),
    [criteria, setCriteria] = useState(""),
    [attendance, setAttendance] = useState("true"),
    [renew, setRenew] = useState(false),
    [interviewerEmail, setInterviewerEmail] = useState(""),
    [emailPending, setEmailPending] = useState(false),
    [newEmailApproved, setNewEmailApproved] = useState(false),
    [approve, setApprove] = useState(false);
  const evidenceDraft = useEvidenceDraft();
  const scorecardDraft = useScorecardDraft();
  const emailRequest = useRef<{ action: string; subject: string; body: string; actionId: string; expectedRevision: number } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (action === "reject" && !approve) return;
    if (action === "interview" && !renew && !interviewerEmail) return;
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
                    ? {}
                    : { text }),
    };
    if (action === "email" && !emailRequest.current) {
      emailRequest.current = { action: "email", subject, body, actionId: crypto.randomUUID(), expectedRevision: resource.data.revision };
      setEmailPending(true);
      setNewEmailApproved(false);
    }
    const payload = action === "email" ? emailRequest.current : draft;
    const result = await mutation.run(
      "/api/hub/applications/" + encodeURIComponent(id) + "/action",
      "POST",
      payload,
      ["reject", "assessment", "interview", "email"].includes(action)
        ? "Decision saved. Delivery status appears in communication history."
        : "Saved to this application.",
    );
    if (result !== undefined) {
      setText("");
      setApprove(false);
      setRenew(false);
      setScore("");
      if (action === "email") { emailRequest.current = null; setEmailPending(false); setNewEmailApproved(false); setSubject(""); setBody(""); }
      await resource.reload();
      changed();
    }
  }
  const detail = resource.data;
  return (
    <section aria-labelledby="candidate-title">
      <button className="hub-text-button hub-back" onClick={back}>
        <ArrowLeft size={16} /> Back to applications
      </button>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {detail && !resource.loading && (
        <>
          <div className="hub-section-heading">
            <div>
              <p className="hub-kicker">{detail.jobTitle}</p>
              <h2 id="candidate-title">{detail.name || "Unnamed applicant"}</h2>
              <p>
                <a href={"mailto:" + detail.email}>{detail.email}</a> · Applied{" "}
                {displayDate(detail.createdAt)}
              </p>
            </div>
            <div className="hub-status-line">
              <button type="button" className="hub-button secondary" onClick={() => void resource.reload()}>Refresh application</button>
              <button type="button" className="hub-button secondary" onClick={() => downloadApplication(detail)}><Download size={16} /> Export this application</button>
              <Badge>{detail.stage}</Badge>
              <Badge tone={qualificationTone(detail.qualification)}>
                {detail.qualification === "review"
                  ? "Needs review"
                  : detail.qualification}
              </Badge>
              {detail.duplicateEmail && <Badge tone="warning">{detail.duplicateApplicationCount} applications share this email</Badge>}
            </div>
          </div>
          <div className="hub-detail-grid">
            <aside className="hub-action-panel hub-card">
              <h3>Next action</h3>
              <p className="hub-muted">
                Assigned to {detail.assignee || "no reviewer"}. Moving a stage
                never sends an invitation.
              </p>
              <form onSubmit={submit}>
                <fieldset disabled={mutation.busy}>
                  <Field label="Action">
                    <select
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value);
                        if(e.target.value === "scorecard") setSection("review");
                        setText("");
                        setApprove(false);
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
                      <option value="attendance">
                        Record interview attendance
                      </option>
                      <option value="email">Send email</option>
                      <option value="reject">Reject application</option>
                    </select>
                  </Field>
                  {["assessment", "interview"].includes(action) && <label className="hub-checkbox"><input type="checkbox" checked={renew} onChange={(e) => setRenew(e.target.checked)} /> Send a replacement secure link and revoke the previous link. Existing responses and bookings remain in history.</label>}
                  {action === "stage" && (
                    <Field label="Stage">
                      <select
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      >
                        {stages
                          .filter((s) => s !== "Rejected")
                          .map((s) => (
                            <option key={s}>{s}</option>
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
                    <><p className="hub-notice">Review this application before sending a secure booking link.</p><InterviewerChoice value={interviewerEmail} change={setInterviewerEmail} renew={renew}/></>
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
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </Field>
                  )}
                  <button
                    className={
                      "hub-button " + (action === "reject" ? "danger" : "")
                    }
                    type="submit"
                    disabled={
                      mutation.busy || (action === "reject" && !approve)
                    }
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
                              : "Save action"}
                  </button>
                </fieldset>
                <Feedback error={mutation.error} success={mutation.success} />
              </form>
            </aside>
            <div className="hub-detail-main">
              <div className="hub-button-row" role="tablist" aria-label="Applicant record">{([{id:"application",label:"Application & files"},{id:"review",label:"AI review & notes"},{id:"activity",label:"Activity & messages"}] as const).map(tab=><button key={tab.id} type="button" role="tab" id={`candidate-tab-${tab.id}`} aria-selected={section===tab.id} tabIndex={section===tab.id?0:-1} onKeyDown={event=>{const ids=["application","review","activity"] as const;const index=ids.indexOf(section);const next=event.key==="ArrowRight"?ids[(index+1)%3]:event.key==="ArrowLeft"?ids[(index+2)%3]:event.key==="Home"?ids[0]:event.key==="End"?ids[2]:null;if(next){event.preventDefault();setSection(next);document.getElementById(`candidate-tab-${next}`)?.focus();}}} aria-controls={`candidate-panel-${tab.id}`} className={"hub-button " + (section===tab.id ? "" : "secondary")} onClick={()=>setSection(tab.id)}>{tab.label}</button>)}</div>
              <div role="tabpanel" id="candidate-panel-review" aria-labelledby="candidate-tab-review" hidden={section!=="review"}>
              {section === "review" && <CandidateMatch applicationId={detail.id}/>}
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
              </div>
              <div role="tabpanel" id="candidate-panel-application" aria-labelledby="candidate-tab-application" hidden={section!=="application"}>
              <section className="hub-card">
                <h3>Application answers</h3>
                {detail.answers.length ? (
                  <dl className="hub-answer-list">
                    {detail.answers.map((answer) => (
                      <div key={answer.path}>
                        <dt>
                          {detail.fields.find(
                            (field) => field.path === answer.path,
                          )?.title || answer.path}
                        </dt>
                        <dd>
                          {detail.fields.find(
                            (field) => field.path === answer.path,
                          )?.type === "File"
                            ? "See original files below."
                            : displayAnswer(answer.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="hub-muted">
                    No application answers were recorded.
                  </p>
                )}
                <h4>Original files</h4>
                {detail.files.length ? (
                  <ul className="hub-file-list">
                    {detail.files.map((file) => (
                      <li key={file.id}>
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download size={16} /> {file.filename}
                        </a>
                        <span>
                          {Math.ceil(file.size / 1024)} KB · {file.contentType}
                        </span>
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
                            ? "Needs review"
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
                    No enabled qualification rules evaluated this application.
                    Human review is required.
                  </p>
                )}
              </section>
              </div>
              <div role="tabpanel" id="candidate-panel-activity" aria-labelledby="candidate-tab-activity" hidden={section!=="activity"}>
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
                    <Badge>{interview.status}</Badge>
                  </div>
                  <p>
                    {displayDate(interview.start, interview.timeZone)}
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
                  {interview.linkExpiresAt && <p className="hub-muted">Secure link {interview.linkActive ? "active" : "unavailable"} · expires {displayDate(interview.linkExpiresAt)}. Use Send interview booking link to renew it.</p>}
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
                    No scorecards yet. Use AI review & notes to record a review.
                  </p>
                )}
              </section>
              <section className="hub-card">
                <h3>Notes</h3>
                {detail.notes.length ? (
                  detail.notes.map((note) => (
                    <article className="hub-history-item" key={note.id}>
                      <strong>{note.actor}</strong>
                      <p className="hub-preserve">{note.text}</p>
                      <small>{displayDate(note.createdAt)}</small>
                    </article>
                  ))
                ) : (
                  <p className="hub-muted">No internal notes yet.</p>
                )}
              </section>
              <section className="hub-card">
                <h3>Communication history</h3>
                {detail.communications.length ? (
                  detail.communications.map((message) => (
                    <article className="hub-history-item" key={message.id}>
                      <div>
                        <strong>{message.subject}</strong>
                        <Badge
                          tone={
                            message.status === "failed" ? "danger" : "neutral"
                          }
                        >
                          {message.status}
                        </Badge>
                      </div>
                      <p className="hub-preserve">{message.body}</p>
                      <small>{displayDate(message.createdAt)}</small>
                    </article>
                  ))
                ) : (
                  <p className="hub-muted">
                    No messages yet. Assessments and interviews require an
                    explicit recruiter action.
                  </p>
                )}
              </section>
              <section className="hub-card">
                <h3>Hiring history</h3>
                {detail.history.length ? (
                  <ol className="hub-history-list">
                    {detail.history.map((event) => (
                      <li key={event.id}>
                        <strong>{event.type}</strong>
                        <p>{event.text}</p>
                        <small>
                          {event.actor} · {displayDate(event.createdAt)}
                        </small>
                      </li>
                    ))}
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
