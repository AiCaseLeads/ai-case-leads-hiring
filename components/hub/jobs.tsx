"use client";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { ApplicationField, FieldType } from "@/lib/hiring/types";
import { useHubMutation, useHubResource } from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { HubJob, Rule, Settings } from "./types";
import { availableJobSlug, jobBatch, jobChoices, jobGroup, jobLocation, matchingJobs, nextBatch, experienceQuestions, withExperienceQuestions } from "./job-organization";

const fieldTypes: FieldType[] = [
  "String",
  "Email",
  "Phone",
  "LongText",
  "File",
  "SocialLink",
  "Url",
  "Number",
  "Date",
  "Boolean",
  "ValueSelect",
  "MultiValueSelect",
  "Score",
];
const fieldLabels: Record<FieldType, string> = {
  String: "Short text",
  Email: "Email address",
  Phone: "Phone number",
  LongText: "Long text",
  File: "File upload",
  SocialLink: "Portfolio link",
  Url: "Website URL",
  Number: "Number",
  Date: "Date",
  Boolean: "Yes / no",
  ValueSelect: "Single choice",
  MultiValueSelect: "Multiple choices",
  Score: "Rating",
};
const starterFields: ApplicationField[] = [
  {
    path: "_systemfield_name",
    title: "Full name",
    type: "String",
    required: true,
  },
  {
    path: "_systemfield_email",
    title: "Email address",
    type: "Email",
    required: true,
  },
  {
    path: "_systemfield_resume",
    title: "Resume",
    type: "File",
    required: false,
  },
  {
    path: "portfolio",
    title: "Portfolio or work samples",
    type: "SocialLink",
    required: false,
  },
];
export function Jobs({
  admin,
  refresh,
  changed,
}: {
  admin: boolean;
  refresh: number;
  changed: () => void;
}) {
  const resource = useHubResource<HubJob[]>("/api/hub/jobs", refresh),
    mutation = useHubMutation();
  const [editing, setEditing] = useState<HubJob | "new" | { copy: HubJob } | null>(null),
    [defaultTemplate, setDefaultTemplate] = useState(""),
    [groupFilter, setGroupFilter] = useState(""),
    [locationFilter, setLocationFilter] = useState(""),
    [batchFilter, setBatchFilter] = useState(""),
    [saved, setSaved] = useState("");
  const jobs = resource.data || [];
  const matching = matchingJobs(jobs, groupFilter, locationFilter);
  async function createRole() {
    const result = await mutation.run<Settings>("/api/hub/settings", "GET", undefined, "");
    if (result) { setDefaultTemplate(result.templates.rejection); setEditing("new"); }
  }
  async function seed() {
    const result = await mutation.run(
      "/api/hub/setup",
      "POST",
      {},
      "The two draft role templates are ready. Add approved descriptions and questions before opening either role.",
    );
    if (result !== undefined) {
      changed();
      void resource.reload();
    }
  }
  if (editing)
    return (
      <JobEditor
        key={editing === "new" ? "new" : "copy" in editing ? "copy-" + editing.copy.id : editing.id}
        job={editing === "new" || "copy" in editing ? undefined : editing}
        copyFrom={editing !== "new" && "copy" in editing ? editing.copy : undefined}
        defaultRejectionTemplate={defaultTemplate}
        jobs={jobs}
        done={(message) => {
          setSaved(message);
          setBatchFilter("");
          setEditing(null);
          changed();
          void resource.reload();
        }}
        cancel={() => setEditing(null)}
      />
    );
  return (
    <section aria-labelledby="roles-title">
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">JOB → LOCATION → BATCH</p>
          <h2 id="roles-title">Jobs & hiring batches</h2>
          <p>
            Choose a job, choose where you are hiring, then open an existing batch or create a new one.
          </p>
        </div>
        {admin && (
          <button className="hub-button" disabled={mutation.busy} onClick={() => void createRole()}>
            <Plus size={16} /> Create job
          </button>
        )}
      </div>
      <Feedback error={mutation.error} success={saved || mutation.success} />
      <div className="hub-notice">
        <strong>A batch is one group of applications for a job and location.</strong>
        <p>For example: Creative Strategist → Spain → October hiring. Open an existing batch to keep using its application page. Create a new batch when you want a fresh set of applications; earlier applicants and files stay saved.</p>
            </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data && !resource.loading && (
        <>
          {resource.data.length ? (
            <>
            <div className="hub-card hub-form-grid">
              <Field label="Choose job"><select value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setLocationFilter(""); setBatchFilter(""); }}><option value="">All jobs</option>{jobChoices(jobs.map(jobGroup)).map(value => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Choose location"><select value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setBatchFilter(""); }}><option value="">All locations</option>{jobChoices(matchingJobs(jobs, groupFilter, "").map(jobLocation)).map(value => <option key={value}>{value}</option>)}</select></Field>
              <Field label="Choose existing batch" hint="Selecting a batch shows its existing posting below."><select value={batchFilter} onChange={e => setBatchFilter(e.target.value)}><option value="">All matching batches</option>{matching.map(job => <option key={job.id} value={job.id}>{jobBatch(job)} · {jobGroup(job)} · {jobLocation(job)} · {job.status} · /jobs/{job.slug}</option>)}</select></Field>
            </div>
            <div className="hub-job-grid">
              {matching.filter(job => !batchFilter || job.id === batchFilter).map((job) => (
                <article className="hub-card hub-role-card" key={job.id}>
                  <div className="hub-status-line">
                    <Badge tone={job.status === "open" ? "success" : "neutral"}>
                      {job.status}
                    </Badge>
                    <Badge tone={job.autoReject ? "warning" : "neutral"}>
                      Auto rejection {job.autoReject ? "active" : "off"}
                    </Badge>
                  </div>
                  <p className="hub-kicker">
                    {jobLocation(job)}
                  </p>
                  <h3>{jobGroup(job)}</h3>
                  <p><strong>{jobBatch(job)}</strong></p>
                  <p className="hub-muted">
                    {job.fields.length} application questions
                  </p>
                  <p className="hub-muted">
                    {job.rules.filter((rule) => rule.enabled).length} enabled
                    qualification rules
                  </p>
                  <p className="hub-muted">
                    Applications and files stay with this batch.
                  </p>
                  {admin ? (
                    <>
                      <button className="hub-button secondary" onClick={() => setEditing(job)}>
                        Open batch
                      </button>
                      <button className="hub-text-button" onClick={() => setEditing({ copy: job })}>
                        Create new batch
                      </button>
                    </>
                  ) : (
                    <p className="hub-muted">
                      Ask an administrator to update this role.
                    </p>
                  )}
                  {job.status === "open" && (
                    <a
                      className="hub-text-button"
                      href={"/jobs/" + encodeURIComponent(job.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View applicant page
                    </a>
                  )}
                </article>
              ))}
            </div>
            </>
          ) : (
            <EmptyState title="Start with your first two roles">
              <p>
                Create draft templates for Full-stack Engineer and Creative
                Strategist. Drafts receive no applications.
              </p>
              {admin ? (
                <button
                  className="hub-button"
                  disabled={mutation.busy}
                  onClick={() => void seed()}
                >
                  {mutation.busy ? "Creating…" : "Create the two draft roles"}
                </button>
              ) : (
                <p>An administrator can create the draft roles.</p>
              )}
            </EmptyState>
          )}
        </>
      )}
    </section>
  );
}
function JobEditor({
  job,
  copyFrom,
  done,
  cancel,
  defaultRejectionTemplate,
  jobs,
}: {
  job?: HubJob;
  copyFrom?: HubJob;
  done: (message: string) => void;
  cancel: () => void;
  defaultRejectionTemplate: string;
  jobs: HubJob[];
}) {
  const source = job || copyFrom;
  const [archiveProject, setArchiveProject] = useState(source?.archiveProject || (copyFrom ? copyFrom.title : "")),
    [archiveCountry, setArchiveCountry] = useState(source ? jobLocation(source) : "International"),
    [hiringRound, setHiringRound] = useState(copyFrom ? nextBatch(jobs, jobGroup(copyFrom), jobLocation(copyFrom)) : job?.hiringRound || (job ? "" : "Batch 1"));
  const [title, setTitle] = useState(source?.title || ""),
    [customSlug, setCustomSlug] = useState<string | null>(job?.slug || null),
    [department, setDepartment] = useState(source?.department || ""),
    [location, setLocation] = useState(source?.location || ""),
    [status, setStatus] = useState(copyFrom ? "draft" : job?.status || "draft"),
    [description, setDescription] = useState(source?.descriptionHtml || ""),
    [fields, setFields] = useState<ApplicationField[]>(
      source?.fields.length
        ? source.fields
        : starterFields.map((field) => ({ ...field })),
    ),
    [rules, setRules] = useState<Rule[]>(source?.rules || []),
    [autoReject, setAutoReject] = useState(copyFrom ? false : job?.autoReject || false),
    [approved, setApproved] = useState(false),
    [descriptionApproved, setDescriptionApproved] = useState(false),
    [rejectionTemplate, setRejectionTemplate] = useState(
      source?.rejectionTemplate ||
        defaultRejectionTemplate,
    ),
    [assessmentPrompt, setAssessmentPrompt] = useState(
      source?.assessmentPrompt || "",
    );
  const slug = customSlug ?? availableJobSlug(title, archiveCountry, hiringRound, jobs);
  const mutation = useHubMutation();
  function updateField(index: number, update: Partial<ApplicationField>) {
    setFields((current) =>
      current.map((field, i) =>
        i === index ? { ...field, ...update } : field,
      ),
    );
    setDescriptionApproved(false);
  }
  function updateRule(index: number, update: Partial<Rule>) {
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...update } : rule)),
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (
      (autoReject && !approved) ||
      (status === "open" && !descriptionApproved)
    )
      return;
    const payload = {
      title,
      slug,
      department,
      location,
      status,
      descriptionHtml: description,
      fields,
      rules,
      autoReject,
      rejectionTemplate,
      assessmentPrompt,
      archiveProject: archiveProject.trim() || title.slice(0, 120),
      archiveCountry,
      hiringRound,
      ...(job ? { formVersion: job.formVersion } : {}),
    };
    const result = await mutation.run(
      job ? "/api/hub/jobs/" + encodeURIComponent(job.id) : "/api/hub/jobs",
      job ? "PATCH" : "POST",
      payload,
      "Role saved.",
    );
    if (result !== undefined) done(status === "open" ? "Batch saved and published. Use View applicant page to check the application form." : status === "closed" ? "Batch closed. Its applications and files remain saved." : "Draft batch saved. Open it when you are ready to publish.");
  }
  return (
    <section aria-labelledby="role-editor-title">
      <button className="hub-text-button hub-back" onClick={cancel}>
        <ArrowLeft size={16} /> Back to jobs
      </button>
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">
            {job ? "EDIT BATCH" : "JOB SETUP"}
          </p>
          <h2 id="role-editor-title">
            {job ? "Edit " + job.title : copyFrom ? "Create a new batch" : "Create a job"}
          </h2>
          <p>
            1. Choose the job and location. 2. Review the application. 3. Save a draft or publish.
          </p>
        </div>
      </div>
      {copyFrom && <div className="hub-notice">This new batch starts as a draft, using the previous description and questions. Earlier batches and applicants stay saved. Automatic rejection starts off.</div>}
      <form onSubmit={save}>
        <fieldset disabled={mutation.busy}>
          <section className="hub-card">
            <h3>1. Job, location & batch</h3>
            <div className="hub-form-grid">
              <Field label="Job title" hint="Choose an existing job title or type a new one.">
                <input required maxLength={160} list="existing-job-titles" value={title} onChange={e => setTitle(e.target.value)} />
                <datalist id="existing-job-titles">{jobChoices(jobs.map(job => job.title)).map(value => <option key={value} value={value} />)}</datalist>
              </Field>
              <Field label="Hiring location" hint="Where you are hiring, such as Spain, USA, or International. This is not the applicant’s nationality.">
                <input required maxLength={120} list="existing-job-locations" value={archiveCountry} onChange={e => { setArchiveCountry(e.target.value); setLocation(e.target.value); }} />
                <datalist id="existing-job-locations">{jobChoices(matchingJobs(jobs, archiveProject || title, "").map(jobLocation)).map(value => <option key={value} value={value} />)}</datalist>
              </Field>
              <Field label="Batch name" hint={job ? "This is the existing batch. Earlier applications keep their saved folder." : "Give this new batch a short name, such as October hiring. To use a previous batch, go back and choose it."}>
                <input required={!job} maxLength={120} value={hiringRound} onChange={e => setHiringRound(e.target.value)} placeholder="Original batch" />
              </Field>
              <Field label="Publication status">
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as HubJob["status"]);
                    setDescriptionApproved(false);
                  }}
                >
                  <option value="draft">Draft — private setup</option>
                  <option value="open">Open — available to applicants</option>
                  <option value="closed">Closed — no new applications</option>
                </select>
              </Field>
            </div>
            <h3>2. What applicants see</h3>
            <Field label="Job description" hint="Enter the approved responsibilities and requirements. Plain text is supported; simple HTML can add paragraphs and lists. Do not add compensation or qualifications that have not been approved.">
              <textarea
                rows={10}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescriptionApproved(false);
                }}
                required={status === "open"}
              />
            </Field>
            <details>
              <summary>Advanced: page address, department & saved folder labels</summary>
              <p className="hub-muted">The page address is generated for new batches. Changing an existing address breaks links shared earlier.</p>
              <div className="hub-form-grid">
                <Field label="Page address"><div className="hub-input-prefix"><span>/jobs/</span><input required maxLength={160} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={e => setCustomSlug(e.target.value)} /></div></Field>
                <Field label="Department"><input maxLength={160} value={department} onChange={e => setDepartment(e.target.value)} /></Field>
                <Field label="Job group" hint="Leave blank to group by job title. Existing group names are preserved."><input maxLength={120} list="existing-job-groups" value={archiveProject} onChange={e => setArchiveProject(e.target.value)} /><datalist id="existing-job-groups">{jobChoices(jobs.map(jobGroup)).map(value => <option key={value} value={value} />)}</datalist></Field>
                <Field label="Public location wording" hint="Optional wording on the job page."><input maxLength={200} value={location} onChange={e => setLocation(e.target.value)} /></Field>
              </div>
              <p className="hub-muted">Saved files use Job → Location → Batch → Applicant. Existing applicants keep their saved location when these labels change.</p>
            </details>
            {status === "open" && (
              <label className="hub-checkbox">
                <input
                  type="checkbox"
                  checked={descriptionApproved}
                  onChange={(e) => setDescriptionApproved(e.target.checked)}
                  required
                />{" "}
                I approve this description and application form for applicants.
                Intake also requires the platform’s launch setting.
              </label>
            )}
          </section>
          <section className="hub-card">
            <div className="hub-section-heading compact">
              <div>
                <h3>Application questions</h3>
                <p>
                  Name and email identify the applicant and support
                  communications.
                </p>
              </div>
              <button
                type="button"
                className="hub-button secondary"
                onClick={() =>
                  setFields((current) => [
                    ...current,
                    {
                      path: "question_" + Date.now().toString(36),
                      title: "",
                      type: "LongText",
                      required: false,
                    },
                  ])
                }
              >
                <Plus size={16} /> Add question
              </button>
            </div>
            <div className="hub-notice">
              <strong>Collect evidence for a fair review</strong>
              <p>Add an optional LinkedIn link, work history, personal contributions, and an accuracy confirmation. Applicants provide their own information; no LinkedIn account is required and profiles are not scraped. Reviewers can compare these answers with the resume.</p>
              <button type="button" className="hub-button secondary" disabled={experienceQuestions.every(question => fields.some(field => field.path === question.path))} onClick={() => { setFields(withExperienceQuestions); setDescriptionApproved(false); }}>
                {experienceQuestions.every(question => fields.some(field => field.path === question.path)) ? "Experience & profile questions added" : "Add experience & profile questions"}
              </button>
            </div>
            <div className="hub-editor-list">
              {fields.map((field, index) => (
                <div className="hub-question" key={index}>
                  <div className="hub-question-heading">
                    <strong>Question {index + 1}</strong>
                    <button
                      type="button"
                      className="hub-icon-button"
                      aria-label={"Remove question " + (index + 1)}
                      disabled={
                        field.path === "_systemfield_name" ||
                        field.path === "_systemfield_email"
                      }
                      onClick={() => {
                        setFields((current) =>
                          current.filter((_, i) => i !== index),
                        );
                        setDescriptionApproved(false);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="hub-form-grid">
                    <Field label="Question label">
                      <input
                        required
                        value={field.title}
                        onChange={(e) =>
                          updateField(index, { title: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Answer format">
                      <select
                        value={field.type}
                        disabled={
                          field.path === "_systemfield_name" ||
                          field.path === "_systemfield_email"
                        }
                        onChange={(e) =>
                          updateField(index, {
                            type: e.target.value as FieldType,
                          })
                        }
                      >
                        {fieldTypes.map((type) => (
                          <option key={type} value={type}>
                            {fieldLabels[type]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <details><summary>Advanced question identifier</summary><Field label="Question identifier">
                      <input
                        required
                        value={field.path}
                        readOnly={field.path.startsWith("_systemfield_")}
                        onChange={(e) =>
                          updateField(index, { path: e.target.value })
                        }
                      />
                    </Field></details>
                    <label className="hub-checkbox">
                      <input
                        type="checkbox"
                        checked={field.required}
                        disabled={
                          field.path === "_systemfield_name" ||
                          field.path === "_systemfield_email"
                        }
                        onChange={(e) =>
                          updateField(index, { required: e.target.checked })
                        }
                      />{" "}
                      Required answer
                    </label>
                  </div>
                  <Field label="Instructions (optional)">
                    <textarea
                      rows={2}
                      value={field.description || ""}
                      onChange={(e) =>
                        updateField(index, { description: e.target.value })
                      }
                    />
                  </Field>
                  {["ValueSelect", "MultiValueSelect"].includes(field.type) && (
                    <ChoiceEditor
                      options={field.options || []}
                      change={(options) => updateField(index, { options })}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
          <details className="hub-card">
            <summary>Optional: qualification rules & rejection email</summary>
            <div className="hub-section-heading compact">
              <div>
                <h3>Qualification rules</h3>
                <p>
                  Each enabled rule describes an approved requirement.
                  Applications that meet the requirements enter recruiter
                  review; missing information always needs a person.
                </p>
              </div>
              <button
                type="button"
                className="hub-button secondary"
                onClick={() =>
                  setRules((current) => [
                    ...current,
                    {
                      fieldPath: fields[0]?.path || "",
                      operator: "equals",
                      value: "",
                      reason: "",
                      enabled: false,
                    },
                  ])
                }
              >
                <Plus size={16} /> Add rule
              </button>
            </div>
            {rules.length ? (
              <div className="hub-editor-list">
                {rules.map((rule, index) => (
                  <div className="hub-question" key={index}>
                    <div className="hub-question-heading">
                      <strong>Requirement {index + 1}</strong>
                      <button
                        type="button"
                        className="hub-icon-button"
                        aria-label={"Remove rule " + (index + 1)}
                        onClick={() => {
                          setRules((current) =>
                            current.filter((_, i) => i !== index),
                          );
                          setApproved(false);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="hub-form-grid">
                      <Field label="Question">
                        <select
                          value={rule.fieldPath}
                          onChange={(e) => {
                            updateRule(index, { fieldPath: e.target.value });
                            setApproved(false);
                          }}
                        >
                          {fields
                            .filter((field) => field.type !== "File")
                            .map((field) => (
                              <option key={field.path} value={field.path}>
                                {field.title || field.path}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Answer must">
                        <select
                          value={rule.operator}
                          onChange={(e) => {
                            updateRule(index, {
                              operator: e.target.value as Rule["operator"],
                            });
                            setApproved(false);
                          }}
                        >
                          <option value="equals">Equal</option>
                          <option value="not_equals">Not equal</option>
                          <option value="contains">Contain</option>
                          <option value="gte">Be at least</option>
                          <option value="lte">Be at most</option>
                        </select>
                      </Field>
                      <RuleValue
                        value={rule.value}
                        change={(value) => {
                          updateRule(index, { value });
                          setApproved(false);
                        }}
                      />
                      <Field label="Rejection reason if requirement is not met">
                        <input
                          required
                          value={rule.reason}
                          onChange={(e) => {
                            updateRule(index, { reason: e.target.value });
                            setApproved(false);
                          }}
                        />
                      </Field>
                    </div>
                    <label className="hub-checkbox">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => {
                          updateRule(index, { enabled: e.target.checked });
                          setApproved(false);
                        }}
                      />{" "}
                      Enable this requirement for qualification review
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hub-muted">
                No rules configured. All applications require human review.
              </p>
            )}
            <label className="hub-checkbox">
              <input
                type="checkbox"
                checked={autoReject}
                onChange={(e) => {
                  setAutoReject(e.target.checked);
                  setApproved(false);
                }}
              />{" "}
              Automatically reject applications that fail enabled requirements
            </label>
            {autoReject && (
              <label className="hub-checkbox hub-notice">
                <input
                  type="checkbox"
                  required
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />{" "}
                I approve these requirements, rules, and rejection emails for
                automatic decisions.
              </label>
            )}
            <Field
              label="Rejection email template"
              hint="Write the approved message. Automatic rejection needs a template and enabled rules."
            >
              <textarea
                rows={6}
                required
                value={rejectionTemplate}
                onChange={(e) => {
                  setRejectionTemplate(e.target.value);
                  setApproved(false);
                }}
              />
            </Field>
          </details>
          <details className="hub-card">
            <summary>Optional: assessment instructions</summary>
            <h3>Assessment prompt</h3>
            <p className="hub-muted">
              Recruiters explicitly send assessments after reviewing an
              application.
            </p>
            <Field label="Saved assessment instructions">
              <textarea
                rows={6}
                value={assessmentPrompt}
                onChange={(e) => setAssessmentPrompt(e.target.value)}
              />
            </Field>
          </details>
          <div className="hub-sticky-save">
            <button
              className="hub-button"
              type="submit"
              disabled={
                mutation.busy ||
                (autoReject && !approved) ||
                (status === "open" && !descriptionApproved)
              }
            >
              {mutation.busy ? "Saving…" : status === "open" ? "Publish batch" : status === "closed" ? "Save closed batch" : "Save draft batch"}
            </button>
            <button
              className="hub-button secondary"
              type="button"
              onClick={cancel}
            >
              Cancel
            </button>
            <Feedback error={mutation.error} success={mutation.success} />
          </div>
        </fieldset>
      </form>
    </section>
  );
}
function RuleValue({
  value,
  change,
}: {
  value: Rule["value"];
  change: (value: Rule["value"]) => void;
}) {
  const type = typeof value;
  return (
    <div className="hub-rule-value">
      <Field label="Value type">
        <select
          value={type}
          onChange={(e) =>
            change(
              e.target.value === "boolean"
                ? false
                : e.target.value === "number"
                  ? 0
                  : "",
            )
          }
        >
          <option value="string">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Yes / no</option>
        </select>
      </Field>
      <Field label="Required value">
        {type === "boolean" ? (
          <select
            value={String(value)}
            onChange={(e) => change(e.target.value === "true")}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            type={type === "number" ? "number" : "text"}
            value={String(value)}
            required
            onChange={(e) =>
              change(
                type === "number" ? Number(e.target.value) : e.target.value,
              )
            }
          />
        )}
      </Field>
    </div>
  );
}

function ChoiceEditor({
  options,
  change,
}: {
  options: NonNullable<ApplicationField["options"]>;
  change: (options: NonNullable<ApplicationField["options"]>) => void;
}) {
  const [text, setText] = useState(
    options
      .map((option) =>
        option.value === option.label
          ? option.value
          : option.value + " | " + option.label,
      )
      .join("\n"),
  );
  return (
    <Field
      label="Choices"
      hint="One choice per line. Use value | label when the stored value differs from the label."
    >
      <textarea
        rows={4}
        required
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          change(
            e.target.value
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => {
                const split = line.split("|");
                return {
                  value: split[0].trim(),
                  label: (split[1] || split[0]).trim(),
                };
              }),
          );
        }}
      />
    </Field>
  );
}
