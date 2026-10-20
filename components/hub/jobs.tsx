"use client";
import { NavigationLink } from "./navigation-link";
import { useEffect, useRef, useState } from "react";
import { Plus, Copy, ExternalLink, Users, Files, Pause, Play, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useHubMutation, useHubResource } from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { HubJob } from "./types";
import type { SetupCatalog } from "@/lib/job-setup/model";
import type { Catalog } from "@/lib/scorecards/model";
import { JobWizard, JobStart } from "./job-wizard";
import { JobActionMenu } from "./action-menu";
import { sortHubJobs } from "./job-order";
import { JobTeamPanel } from "./job-team";
import type { JobLifecycleAction } from "@/lib/hub/job-lifecycle";
const completedJobSessions = new Set<string>();
export function Jobs({
  admin,
  refresh,
  changed,
  startCreating = false,
  onManageScorecards,
}: {
  admin: boolean;
  refresh: number;
  changed: () => void;
  startCreating?: boolean;
  onManageScorecards?: () => void;
}) {
  const drafts = useHubResource<
    {
      key: string;
      revision: number;
      updatedAt: number;
      title: string;
      startKind: JobStart["kind"];
      sourceId: string;
    }[]
  >("/api/job-drafts", refresh);
  const currentSession = useRef("");
  const [editorSession, setEditorSession] = useState("");
  const jobs = useHubResource<HubJob[]>("/api/hub/jobs", refresh),
    setup = useHubResource<SetupCatalog>("/api/job-setup", refresh),
    scores = useHubResource<Catalog>("/api/scorecards", refresh),
    mutation = useHubMutation();
  const [editing, setEditing] = useState<HubJob | null>(null),
    [creating, setCreating] = useState(startCreating),
    [editorVisible, setEditorVisible] = useState(startCreating),
    [choosingStart, setChoosingStart] = useState(startCreating),
    [start, setStart] = useState<JobStart | null>(null),
    [collection, setCollection] = useState("active"),
    [status, setStatus] = useState("all"),
    [search, setSearch] = useState(""),
    [success, setSuccess] = useState(""),
    [templateJob, setTemplateJob] = useState<HubJob | null>(null),
    [templateName, setTemplateName] = useState("");
  const [teamJob, setTeamJob] = useState<HubJob | null>(null);
  const [deleteJob, setDeleteJob] = useState<HubJob | null>(null);
  const deleteDialog = useRef<HTMLElement>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!deleteJob) return;
    // Start on Cancel; deleting is reversible but should still be deliberate.
    deleteDialog.current?.querySelector<HTMLButtonElement>("button:last-child")?.focus();
    return () => deleteTrigger.current?.focus();
  }, [deleteJob]);
  const reloadDrafts = drafts.reload;
  const previousEditorVisible = useRef(editorVisible);
  useEffect(() => {
    // History traversal can close the editor without calling closeEditor.
    // Refresh after every visible-to-hidden transition so discarded or saved
    // recovery copies are reflected immediately in the Jobs list.
    if (previousEditorVisible.current && !editorVisible) void reloadDrafts();
    previousEditorVisible.current = editorVisible;
  }, [editorVisible, reloadDrafts]);

  function editorUrl(editor: string | null, chosen?: JobStart) {
    const url = new URL(window.location.href);
    for (const key of [
      "jobEditor",
      "jobStep",
      "jobStart",
      "jobSource",
      "jobSession",
    ])
      url.searchParams.delete(key);
    if (editor) {
      url.searchParams.set("jobSession", currentSession.current);
      url.searchParams.set("jobEditor", editor);
      url.searchParams.set(
        "jobStep",
        editor === "new" && !chosen ? "start" : "0",
      );
      if (chosen) {
        url.searchParams.set("jobStart", chosen.kind);
        const source =
          chosen.kind === "duplicate"
            ? chosen.source.id
            : chosen.kind === "template"
              ? chosen.template.id
              : chosen.kind === "request"
                ? chosen.request.id
                : "";
        if (source) url.searchParams.set("jobSource", source);
      }
    }
    return url;
  }
  function openEditor(job?: HubJob, chosen?: JobStart, targetStep = 0) {
    if (job?.lifecycle && job.lifecycle.state !== "active") return;
    currentSession.current = crypto.randomUUID();
    setEditorSession(currentSession.current);
    setEditing(job || null);
    setCreating(!job);
    setStart(chosen || null);
    setChoosingStart(!job && !chosen);
    setEditorVisible(true);
    const url = editorUrl(job?.id || "new", chosen);
    if (job && targetStep > 0) url.searchParams.set("jobStep", String(targetStep));
    window.history.pushState({ aiclHub: true }, "", url);
  }
  function chooseStart(chosen: JobStart) {
    const identity = (value: JobStart) =>
      value.kind +
      ":" +
      (value.kind === "duplicate"
        ? value.source.id
        : value.kind === "template"
          ? value.template.id
          : value.kind === "request"
            ? value.request.id
            : "");
    if (start && identity(start) !== identity(chosen)) {
      currentSession.current = crypto.randomUUID();
      setEditorSession(currentSession.current);
    }
    setStart(chosen);
    setChoosingStart(false);
    window.history.pushState({ aiclHub: true }, "", editorUrl("new", chosen));
  }
  function closeEditor() {
    setEditorVisible(false);
    window.history.pushState({ aiclHub: true }, "", editorUrl(null));
  }
  useEffect(() => {
    const restore = () => {
      if (!admin) {
        setEditorVisible(false);
        return;
      }
      const params = new URLSearchParams(window.location.search),
        editor = params.get("jobEditor");
      if (!editor) {
        setEditorVisible(false);
        return;
      }
      const session =
        params.get("jobSession") ||
        currentSession.current ||
        crypto.randomUUID();
      if (completedJobSessions.has(session)) {
        setEditorVisible(false);
        window.history.replaceState({ aiclHub: true }, "", editorUrl(null));
        return;
      }
      currentSession.current = session;
      setEditorSession(session);
      if (editor !== "new") {
        const job = jobs.data?.find((item) => item.id === editor);
        if (!job) return;
        if (job.lifecycle && job.lifecycle.state !== "active") {
          setEditorVisible(false);
          window.history.replaceState({ aiclHub: true }, "", editorUrl(null));
          return;
        }
        setEditing(job);
        setCreating(false);
        setChoosingStart(false);
        setEditorVisible(true);
        return;
      }
      setEditing(null);
      setCreating(true);
      setEditorVisible(true);
      setChoosingStart(params.get("jobStep") === "start");
      const kind = params.get("jobStart"),
        source = params.get("jobSource");
      if (kind === "duplicate") {
        const found = jobs.data?.find((item) => item.id === source);
        if (found) setStart({ kind, source: found });
      } else if (kind === "template") {
        const found = setup.data?.templates.find((item) => item.id === source);
        if (found) setStart({ kind, template: found });
      } else if (kind === "request") {
        const found = setup.data?.requests.find((item) => item.id === source);
        if (found) setStart({ kind, request: found });
      } else if (kind === "blank") setStart({ kind });
    };
    queueMicrotask(restore);
    window.addEventListener("popstate", restore);
    window.addEventListener("hub:navigate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hub:navigate", restore);
    };
  }, [admin, jobs.data, setup.data]);
  useEffect(() => {
    if (startCreating) queueMicrotask(() => openEditor());
    // A Home shortcut starts a workflow; ordinary refreshes do not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCreating]);
  function done(message: string, session: string) {
    completedJobSessions.add(session);
    if (completedJobSessions.size > 100)
      completedJobSessions.delete(completedJobSessions.values().next().value!);
    if (currentSession.current !== session) {
      changed();
      void jobs.reload();
      void setup.reload();
      void scores.reload();
      return;
    }
    window.history.replaceState({ aiclHub: true }, "", editorUrl(null));
    setEditorVisible(false);
    setSuccess(message);
    setEditing(null);
    setCreating(false);
    setStart(null);
    changed();
    void jobs.reload();
    void setup.reload();
    void scores.reload();
  }
  const data = jobs.data || [];
  async function lifecycleAction(job: HubJob, action: JobLifecycleAction) {
    setSuccess("");
    const messages = {
      pause: "Job paused. New applications are closed; existing applicants stay available.",
      resume: "Job resumed. Applicants can apply again.",
      archive: "Job archived. Find it in Archived; all applications and files are kept.",
      delete: "Job moved to Trash. Applications and files are kept, and you can restore the job.",
      restore: "Job restored as Paused. Resume it when you want to accept applications again.",
    };
    const result = await mutation.run<HubJob>(`/api/hub/jobs/${encodeURIComponent(job.id)}/lifecycle`, "POST", {
      action, formVersion: job.formVersion, lifecycleRevision: job.lifecycle?.revision || 0,
    }, messages[action]);
    if (result) {
      setDeleteJob(null);
      if (teamJob?.id === job.id) setTeamJob(null);
      changed();
      void jobs.reload();
    }
  }
  const editor =
    (editing || creating) && jobs.data && setup.data && scores.data ? (
      <JobWizard
        active={editorVisible}
        key={editorSession}
        job={editing || undefined}
        start={start || undefined}
        jobs={data}
        catalog={setup.data}
        scorecards={scores.data}
        chooseStart={choosingStart}
        onChoose={chooseStart}
        cancel={closeEditor}
        done={(message) => done(message, editorSession)}
        onManageScorecards={onManageScorecards}
      />
    ) : null;
  const filtered = sortHubJobs(data).filter(
    (j) =>
      (j.lifecycle?.state || "active") === collection &&
      (status === "all" || j.status === status) &&
      [j.title, j.location, j.department]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div hidden={!editorVisible}>{editorVisible ? editor : null}</div>
      <section hidden={editorVisible} aria-labelledby="jobs-title">
        {!!drafts.data?.length && (
          <section className="hub-saved-drafts" aria-label="Your saved job progress">
            <h3>Continue a saved draft <span className="hub-muted">({drafts.data.length})</span></h3>
            {drafts.data.map((draft) => (
              <div key={draft.key} className="hub-inline">
                <strong>{draft.title || "Untitled job"}</strong>
                <span>Saved {new Date(draft.updatedAt).toLocaleString()}</span>
                <button
                  type="button"
                  className="hub-text-button"
                  onClick={() => {
                    if (!draft.key.startsWith("new:")) {
                      const found = data.find((j) => j.id === draft.key);
                      if (found?.lifecycle && found.lifecycle.state !== "active") {
                        setCollection(found.lifecycle.state);
                        setStatus("all");
                        setSuccess("Restore this job to continue its saved progress. The saved draft is kept.");
                      } else if (found) openEditor(found);
                      return;
                    }
                    if (draft.startKind === "blank")
                      openEditor(undefined, { kind: "blank" });
                    else if (draft.startKind === "duplicate") {
                      const source = data.find((j) => j.id === draft.sourceId);
                      if (source)
                        openEditor(undefined, { kind: "duplicate", source });
                    } else if (draft.startKind === "template") {
                      const template = setup.data?.templates.find(
                        (t) => t.id === draft.sourceId,
                      );
                      if (template)
                        openEditor(undefined, { kind: "template", template });
                    } else {
                      const request = setup.data?.requests.find(
                        (r) => r.id === draft.sourceId,
                      );
                      if (request)
                        openEditor(undefined, { kind: "request", request });
                    }
                  }}
                >
                  Resume draft
                </button>
              </div>
            ))}
          </section>
        )}

        <div className="hub-section-heading">
          <div>
            <p className="hub-kicker">HIRING</p>
            <h2 id="jobs-title">Jobs</h2>
            <p>Manage your job postings and their applicants.</p>
          </div>
          {admin && (
            <button
              className="hub-button"
              disabled={mutation.busy}
              onClick={() => {
                openEditor();
              }}
            >
              <Plus size={16} /> Create job
            </button>
          )}
        </div>
        <Feedback
          error={deleteJob ? "" : mutation.error}
          success={success || mutation.success}
        />
        {deleteJob && <div className="hub-draft-overlay"><section ref={deleteDialog} className="hub-card hub-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-job-title" aria-describedby="delete-job-description" onKeyDown={event => {
          if (event.key === "Escape" && !mutation.busy) { event.preventDefault(); setDeleteJob(null); }
          if (event.key !== "Tab") return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          if (!buttons.length) { event.preventDefault(); return; }
          const first = buttons[0], last = buttons.at(-1)!;
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
          <h3 id="delete-job-title">Move “{deleteJob.title}” to Trash?</h3>
          <p id="delete-job-description">This removes the job from your active list and closes new applications. Existing applicants, PDFs and Drive files stay saved. You can restore the job from Trash.</p>
          {mutation.error && <p role="alert">{mutation.error}</p>}
          <div className="hub-inline">
            <button className="hub-button" type="button" disabled={mutation.busy} onClick={() => void lifecycleAction(deleteJob, "delete")}><Trash2 size={16} /> Move job to Trash</button>
            <button className="hub-text-button" type="button" disabled={mutation.busy} onClick={() => setDeleteJob(null)}>Cancel deletion</button>
          </div>
        </section></div>}
        {teamJob && (
          <JobTeamPanel
            key={teamJob.id}
            jobId={teamJob.id}
            title={teamJob.title}
            admin={admin}
            close={() => setTeamJob(null)}
          />
        )}
        <ResourceState
          loading={jobs.loading || setup.loading || scores.loading}
          error={jobs.error || setup.error || scores.error}
          retry={() => {
            void jobs.reload();
            void setup.reload();
            void scores.reload();
          }}
        />
        <nav className="hub-page-tabs" aria-label="Job lists">
          {([['active', 'Current jobs'], ['archived', 'Archived'], ['deleted', 'Trash']] as const).map(([value, label]) => <button
            key={value} type="button" className={"hub-text-button " + (collection === value ? "active" : "")}
            aria-current={collection === value ? "page" : undefined}
            onClick={() => { setCollection(value); setStatus("all"); setDeleteJob(null); }}
          >{label} <span className="hub-muted">({data.filter(job => (job.lifecycle?.state || "active") === value).length})</span></button>)}
        </nav>
        {collection === "archived" && <p className="hub-muted">Archived jobs are closed to new applications. Review their applicants or restore a job when you need it again.</p>}
        {collection === "deleted" && <p className="hub-muted">Deleted jobs are kept here for recovery. Applications and files are retained. Restore a job to manage it again.</p>}
        <div className="hub-job-filters hub-form-grid">
          <Field label="Search jobs">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Job title or location"
            />
          </Field>
          {collection === "active" && <Field label="Job status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All current jobs</option>
              <option value="open">Open jobs</option>
              <option value="closed">Paused jobs</option>
              <option value="draft">Drafts</option>
            </select>
          </Field>}
        </div>
        {!jobs.loading &&
          !jobs.error &&
          (filtered.length ? (
            <div className="hub-job-list">
              {filtered.map((j) => (
                <article className="hub-job-row" key={j.id}>
                  <div className="hub-job-info">
                    <div className="hub-job-title-row">
                      <h3><a className="hub-object-link" href={"/team?view=applications&jobId="+encodeURIComponent(j.id)}>{j.title}</a></h3>
                      <Badge tone={j.status === "open" ? "success" : "neutral"}>
                        {collection === "archived" ? "Archived" : collection === "deleted" ? "In Trash" : j.status === "open" ? "Open" : j.status === "closed" ? "Paused" : "Draft"}
                      </Badge>
                    </div>
                    <p className="hub-muted">
                      {j.location || j.archiveCountry || "Location not set"}
                      {j.department ? ` · ${j.department}` : ""}
                      {j.aiMatchEnabled ? " · AI matching on" : ""}
                    </p>
                  </div>
                  <div className="hub-job-actions">
                    <a
                      className="hub-button secondary"
                      href={"/team?view=applications&jobId=" + encodeURIComponent(j.id)}
                      aria-label={`View applicants for ${j.title}`}
                    >View applicants</a>
                    {admin && collection === "active" && (
                      <NavigationLink className="hub-text-button" href={"/team?view=jobs&jobEditor="+encodeURIComponent(j.id)+"&jobStep=0"} navigate={() => {if(!mutation.busy)openEditor(j);}}>
                        Edit job
                      </NavigationLink>
                    )}
                    {admin && collection !== "active" && <button className="hub-text-button" disabled={mutation.busy} onClick={() => void lifecycleAction(j, "restore")}><ArchiveRestore size={15} /> Restore job</button>}
                    <JobActionMenu label={`Actions for ${j.title}`}>
{admin && collection === "active" && j.status !== "draft" && <button className="hub-text-button" disabled={mutation.busy} onClick={() => void lifecycleAction(j, j.status === "open" ? "pause" : "resume")}>{j.status === "open" ? <><Pause size={15} /> Pause job</> : <><Play size={15} /> Resume job</>}</button>}
                        {collection === "active" && <button
                          className="hub-text-button"
                          disabled={mutation.busy}
                          aria-expanded={teamJob?.id === j.id}
                          onClick={(event) => {
                            event.currentTarget.closest("details")?.removeAttribute("open");
                            setTeamJob(teamJob?.id === j.id ? null : j);
                          }}
                        ><Users size={15} /> Hiring team & emails</button>}
                        {admin && <>
                          {collection !== "deleted" && <button className="hub-text-button" disabled={mutation.busy} onClick={() => openEditor(undefined, { kind: "duplicate", source: j })}>
                            <Copy size={15} /> Duplicate job
                          </button>}
                          {collection !== "deleted" && <button className="hub-text-button" disabled={mutation.busy} onClick={(event) => {
                            event.currentTarget.closest("details")?.removeAttribute("open");
                            setSuccess("");
                            mutation.clear();
                            setTemplateJob(j);
                            setTemplateName(j.title);
                          }}><Files size={15} /> Save as template</button>}
                          {collection === "active" && <button className="hub-text-button" disabled={mutation.busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void lifecycleAction(j, "archive"); }}><Archive size={15} /> Archive job</button>}
                          {collection !== "deleted" && <button className="hub-text-button" disabled={mutation.busy} onClick={(event) => { const details = event.currentTarget.closest("details"); deleteTrigger.current = details?.querySelector("summary") || null; details?.removeAttribute("open"); setDeleteJob(j); setSuccess(""); mutation.clear(); }}><Trash2 size={15} /> Delete job</button>}
                        </>}
                        {j.status === "open" && (
                          <a className="hub-text-button" href={"/jobs/" + encodeURIComponent(j.slug)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={15} /> View public job
                          </a>
                        )}
                    </JobActionMenu>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title={collection === "archived" ? "No archived jobs" : collection === "deleted" ? "Trash is empty" : data.length ? "No matching jobs" : "Create your first job"}
            >
              <p>
                {collection !== "active" ? "Your open, draft and paused jobs are in the Current jobs tab." : data.length
                  ? "Try another filter or search."
                  : "Start blank, duplicate an existing posting, use a saved template, or fill out a hiring request."}
              </p>
            </EmptyState>
          ))}
        {templateJob && (
          <form
            className="hub-card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!setup.data) return;
              const result = await mutation.run<SetupCatalog>(
                "/api/job-setup",
                "PATCH",
                {
                  action: "template",
                  expectedRevision: setup.data.revision,
                  sourceJobId: templateJob.id,
                  name: templateName,
                },
                "Job template saved. Choose it next time you create a job.",
              );
              if (result) {
                setTemplateJob(null);
                void setup.reload();
              }
            }}
          >
            <h3>Save a reusable job template</h3>
            <p>
              Reuse this job’s description, questions and review settings next time.
              Its applicants stay with the original posting.
            </p>
            <fieldset
              disabled={mutation.busy}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <Field label="Template name">
                <input
                  required
                  maxLength={120}
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </Field>
              <button className="hub-button" disabled={mutation.busy}>
                Save template
              </button>
              <button
                type="button"
                className="hub-text-button"
                onClick={() => setTemplateJob(null)}
              >
                Cancel
              </button>
            </fieldset>
          </form>
        )}
      </section>
    </>
  );
}
