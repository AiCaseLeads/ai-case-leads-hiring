"use client";
import { useState } from "react";
import { Plus, Copy } from "lucide-react";
import { useHubMutation, useHubResource } from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { HubJob } from "./types";
import type { SetupCatalog } from "@/lib/job-setup/model";
import type { Catalog } from "@/lib/scorecards/model";
import { JobWizard, JobStart } from "./job-wizard";
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
  const jobs = useHubResource<HubJob[]>("/api/hub/jobs", refresh),
    setup = useHubResource<SetupCatalog>("/api/job-setup", refresh),
    scores = useHubResource<Catalog>("/api/scorecards", refresh),
    mutation = useHubMutation();
  const [editing, setEditing] = useState<HubJob | null>(null),
    [creating, setCreating] = useState(startCreating),
    [start, setStart] = useState<JobStart | null>(null),
    [status, setStatus] = useState("active"),
    [search, setSearch] = useState(""),
    [success, setSuccess] = useState(""),
    [templateJob, setTemplateJob] = useState<HubJob | null>(null),
    [templateName, setTemplateName] = useState("");
  function done(message: string) {
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
  if ((editing || creating) && jobs.data && setup.data && scores.data)
    return (
      <JobWizard
        key={editing?.id || "new"}
        job={editing || undefined}
        start={start || undefined}
        jobs={data}
        catalog={setup.data}
        scorecards={scores.data}
        chooseStart={!editing && !start}
        onChoose={setStart}
        cancel={() => {
          setEditing(null);
          setCreating(false);
          setStart(null);
        }}
        done={done}
        onManageScorecards={onManageScorecards}
      />
    );
  const filtered = data.filter(
    (j) =>
      (status === "all" ||
        (status === "active" && j.status !== "closed") ||
        j.status === status) &&
      [j.title, j.location, j.department]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section aria-labelledby="jobs-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">HIRING</p>
          <h2 id="jobs-title">Jobs</h2>
          <p>
            Create a posting, review its applicants, and close it when hiring is
            finished.
          </p>
        </div>
        {admin && (
          <button
            className="hub-button"
            onClick={() => {
              setStart(null);
              setCreating(true);
            }}
          >
            <Plus size={16} /> Create job
          </button>
        )}
      </div>
      <Feedback error={mutation.error} success={success || mutation.success} />
      <ResourceState
        loading={jobs.loading || setup.loading || scores.loading}
        error={jobs.error || setup.error || scores.error}
        retry={() => {
          void jobs.reload();
          void setup.reload();
          void scores.reload();
        }}
      />
      <div className="hub-card hub-form-grid">
        <Field label="Search jobs">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Job title or location"
          />
        </Field>
        <Field label="Show postings">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Open jobs and drafts</option>
            <option value="open">Open jobs</option>
            <option value="draft">Drafts</option>
            <option value="closed">Previous postings</option>
            <option value="all">All postings</option>
          </select>
        </Field>
      </div>
      <p className="hub-muted">
        Each posting keeps its own applicants and files. Hiring again? Duplicate
        a job to create a fresh posting. Previous applicants stay saved.
      </p>
      {!jobs.loading &&
        !jobs.error &&
        (filtered.length ? (
          <div className="hub-job-grid">
            {filtered.map((j) => (
              <article className="hub-card hub-role-card" key={j.id}>
                <Badge tone={j.status === "open" ? "success" : "neutral"}>
                  {j.status === "open"
                    ? "Open"
                    : j.status === "closed"
                      ? "Closed"
                      : "Draft"}
                </Badge>
                <h3>{j.title}</h3>
                <p>{j.location || j.archiveCountry || "Location not set"}</p>
                <p className="hub-muted">
                  {j.fields.length} application fields ·{" "}
                  {scores.data?.bindings[j.id]
                    ? "Scorecard assigned"
                    : "Manual review"}
                </p>
                <p className="hub-muted">/jobs/{j.slug}</p>
                {admin && (
                  <>
                    <button
                      className="hub-button secondary"
                      onClick={() => setEditing(j)}
                    >
                      Edit job
                    </button>
                    <button
                      className="hub-text-button"
                      onClick={() => {
                        setStart({ kind: "duplicate", source: j });
                        setCreating(true);
                      }}
                    >
                      <Copy size={14} /> Duplicate job
                    </button>
                    <button
                      className="hub-text-button"
                      onClick={() => {
                        setTemplateJob(j);
                        setTemplateName(j.title);
                      }}
                    >
                      Save as template
                    </button>
                  </>
                )}
                <a
                  className="hub-text-button"
                  href={
                    "/team?view=applications&jobId=" + encodeURIComponent(j.id)
                  }
                >
                  View applicants
                </a>
                {j.status === "open" && (
                  <a
                    className="hub-text-button"
                    href={"/jobs/" + encodeURIComponent(j.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View public job
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={data.length ? "No matching jobs" : "Create your first job"}
          >
            <p>
              {data.length
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
            This copies the description, application questions, location and
            assigned scorecard. Applicants are never copied.
          </p>
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
        </form>
      )}
    </section>
  );
}
