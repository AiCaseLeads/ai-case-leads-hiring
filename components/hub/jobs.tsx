"use client";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { ApplicationField, FieldType } from "@/lib/hiring/types";
import { useHubMutation, useHubResource } from "./api";
import { Badge, EmptyState, Feedback, Field, ResourceState } from "./shared";
import type { HubJob, Rule, Settings } from "./types";

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
    [defaultTemplate, setDefaultTemplate] = useState("");
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
        done={() => {
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
          <p className="hub-kicker">EDITABLE ROLE TEMPLATES</p>
          <h2 id="roles-title">Roles & application forms</h2>
          <p>
            Descriptions, questions, qualification rules, and assessment prompts
            live here.
          </p>
        </div>
        {admin && (
          <button className="hub-button" disabled={mutation.busy} onClick={() => void createRole()}>
            <Plus size={16} /> Add role
          </button>
        )}
      </div>
      <Feedback error={mutation.error} success={mutation.success} />
      <div className="hub-notice">
        <strong>Post a role in three steps</strong>
        <ol><li>Edit the role description and application questions.</li><li>Save as Draft while you review the form and approved qualification rules.</li><li>Choose Open, approve the description and form, and save. The applicant page becomes available; applications also require intake to be enabled in the platform’s launch configuration.</li></ol>
        <p>Reviewer grades come from manager scorecards. Qualification rules explain requirements met or unmet. Automatic rejection remains off unless you explicitly approve it.</p>
      </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data && !resource.loading && (
        <>
          {resource.data.length ? (
            <div className="hub-job-grid">
              {resource.data.map((job) => (
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
                    {job.department || "No department set"}
                  </p>
                  <h3>{job.title}</h3>
                  <p className="hub-muted">
                    {job.fields.length} application questions · Form version{" "}
                    {job.formVersion}
                  </p>
                  <p className="hub-muted">
                    {job.rules.filter((rule) => rule.enabled).length} enabled
                    qualification rules
                  </p>
                  <p className="hub-muted">
                    Archive: {job.archiveProject || job.title} / {job.archiveCountry || "International"} / {(job.hiringRound || job.title) + " (" + job.id + ")"}
                  </p>
                  {admin ? (
                    <>
                      <button className="hub-button secondary" onClick={() => setEditing(job)}>
                        Edit role & form
                      </button>
                      <button className="hub-text-button" onClick={() => setEditing({ copy: job })}>
                        Create new hiring round
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
}: {
  job?: HubJob;
  copyFrom?: HubJob;
  done: () => void;
  cancel: () => void;
  defaultRejectionTemplate: string;
}) {
  const source = job || copyFrom;
  const [archiveProject, setArchiveProject] = useState(source?.archiveProject || (copyFrom ? copyFrom.title : "")),
    [archiveCountry, setArchiveCountry] = useState(source?.archiveCountry || ""),
    [hiringRound, setHiringRound] = useState(copyFrom ? "" : job?.hiringRound || "");
  const [title, setTitle] = useState(source?.title || ""),
    [slug, setSlug] = useState(() => copyFrom ? copyFrom.slug.slice(0, 60).replace(/-+$/, "") + "-" + crypto.randomUUID() : job?.slug || ""),
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
      archiveProject,
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
    if (result !== undefined) done();
  }
  return (
    <section aria-labelledby="role-editor-title">
      <button className="hub-text-button hub-back" onClick={cancel}>
        <ArrowLeft size={16} /> Back to roles
      </button>
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">
            {job ? "ROLE CONFIGURATION" : "NEW ROLE"}
          </p>
          <h2 id="role-editor-title">
            {job ? "Edit " + job.title : copyFrom ? "Create a new hiring round" : "Create a role"}
          </h2>
          <p>
            Keep qualifications specific and approved. Automatic rejection
            starts off.
          </p>
        </div>
      </div>
      {copyFrom && <div className="hub-notice">This creates a separate draft with a new page address. The previous role and all its applications remain unchanged. Review the market and round below before publishing.</div>}
      <form onSubmit={save}>
        <fieldset disabled={mutation.busy}>
          <section className="hub-card">
            <h3>Role details</h3>
            <div className="hub-form-grid">
              <Field label="Job title">
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field
                label="Page address"
                hint="Use lowercase letters, numbers, and hyphens."
              >
                <div className="hub-input-prefix">
                  <span>/jobs/</span>
                  <input
                    required
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Department">
                <input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                />
              </Field>
              <Field label="Location / applicant region">
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Enter approved location wording"
                />
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
            <h3>Shared Drive archive grouping</h3>
            <p>Recruiting / Project or role / Country or market / Hiring round / Applicant. Use a separate role posting for each market, such as Spain and USA. This is the job’s hiring market, not the applicant’s nationality.</p>
            <div className="hub-form-grid">
              <Field label="Project or role" hint="Defaults to the job title.">
                <input maxLength={120} value={archiveProject} onChange={(e) => setArchiveProject(e.target.value)} placeholder={title || "Job title"} />
              </Field>
              <Field label="Country or market" hint="Defaults to International.">
                <input maxLength={120} value={archiveCountry} onChange={(e) => setArchiveCountry(e.target.value)} placeholder="International" />
              </Field>
              <Field label="Hiring round" hint="Leave blank for the job title. Every round folder also includes its unique job ID.">
                <input maxLength={120} value={hiringRound} onChange={(e) => setHiringRound(e.target.value)} placeholder="For example: October 2026" />
              </Field>
            </div>
            <p className="hub-muted">New applications use this grouping. Existing applicants keep their saved archive location. Reposting creates a new draft and keeps earlier applications.</p>
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
                    <Field label="Question identifier">
                      <input
                        required
                        value={field.path}
                        readOnly={field.path.startsWith("_systemfield_")}
                        onChange={(e) =>
                          updateField(index, { path: e.target.value })
                        }
                      />
                    </Field>
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
          <section className="hub-card">
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
          </section>
          <section className="hub-card">
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
          </section>
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
              {mutation.busy ? "Saving role…" : "Save role & configuration"}
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
