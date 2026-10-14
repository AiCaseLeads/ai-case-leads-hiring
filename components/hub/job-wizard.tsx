"use client";
import { hasDescriptionText } from "@/lib/job-description";
import { DescriptionEditor } from "./description-editor";
import { SafeDescription } from "../careers/safe-description";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { hubRequest, useHubMutation } from "./api";
import { Badge, Feedback, Field, ResourceState } from "./shared";
import { JobTeamFields, useJobTeam } from "./job-team";
import type { HubJob, Rule } from "./types";
import type { ApplicationField, FieldType } from "@/lib/hiring/types";
import {
  defaultAnchors,
  inferredLocation,
  publicLocation,
  type SetupCatalog,
  type JobRequest,
  type JobTemplate,
  type WorkLocation,
} from "@/lib/job-setup/model";
import type { Catalog, Rubric } from "@/lib/scorecards/model";
import { availableJobSlug, experienceQuestions } from "./job-organization";
export type JobStart =
  | { kind: "blank" }
  | { kind: "duplicate"; source: HubJob }
  | { kind: "template"; template: JobTemplate }
  | { kind: "request"; request: JobRequest };
const starter: ApplicationField[] = [
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
const formats: Partial<Record<FieldType, string>> = {
  String: "Short answer",
  LongText: "Long answer",
  Boolean: "Yes / no",
  ValueSelect: "Choose one",
  MultiValueSelect: "Choose several",
  File: "Upload a file",
  Url: "Website link",
  SocialLink: "Portfolio link",
  Phone: "Phone number",
  Number: "Number",
  Email: "Email address",
  Date: "Date",
  Score: "Rating",
};
const countryCodes =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
const display = new Intl.DisplayNames(["en"], { type: "region" });
const countries = countryCodes
  .map((c) => display.of(c) || c)
  .sort((a, b) => a.localeCompare(b));
export function LocationFields({
  value,
  change,
}: {
  value: WorkLocation;
  change: (v: WorkLocation) => void;
}) {
  return (
    <div className="hub-form-grid">
      <Field label="Work arrangement">
        <select
          value={value.workModel}
          onChange={(e) =>
            change({
              ...value,
              workModel: e.target.value as WorkLocation["workModel"],
              city: e.target.value === "remote" ? "" : value.city,
              country:
                e.target.value !== "remote" && value.country === "International"
                  ? ""
                  : value.country,
            })
          }
        >
          <option value="" disabled>
            Choose work arrangement
          </option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid — some days in an office</option>
          <option value="onsite">On-site — at a specific workplace</option>
        </select>
      </Field>
      <Field
        label={
          value.workModel === "remote"
            ? "Where can applicants work from?"
            : "Country"
        }
      >
        <select
          required
          value={value.country}
          onChange={(e) => change({ ...value, country: e.target.value })}
        >
          <option value="">Choose a country</option>
          {value.workModel === "remote" && (
            <option value="International">Worldwide</option>
          )}
          {value.country &&
            value.country !== "International" &&
            !countries.includes(value.country) && (
              <option value={value.country}>{value.country}</option>
            )}
          {countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      {value.workModel !== "remote" && (
        <Field label="City">
          <input
            required
            maxLength={120}
            value={value.city}
            onChange={(e) => change({ ...value, city: e.target.value })}
            placeholder="City of the workplace"
          />
        </Field>
      )}
    </div>
  );
}
function StartChoices({
  jobs,
  catalog,
  choose,
  back,
}: {
  jobs: HubJob[];
  catalog: SetupCatalog;
  choose: (s: JobStart) => void;
  back: () => void;
}) {
  const mutation = useHubMutation();
  const [mode, setMode] = useState<"duplicate" | "template" | "request" | null>(
      null,
    ),
    [picked, setPicked] = useState(""),
    [requestTitle, setRequestTitle] = useState(""),
    [location, setLocation] = useState<WorkLocation>({
      workModel: "remote",
      country: "International",
      city: "",
    }),
    [description, setDescription] = useState(""),
    [reason, setReason] = useState(""),
    [requests, setRequests] = useState(catalog.requests),
    [revision, setRevision] = useState(catalog.revision),
    [newRequest, setNewRequest] = useState(false);
  return (
    <>
      <button className="hub-text-button hub-back" onClick={back}>
        <ArrowLeft size={16} /> Back to jobs
      </button>
      <div className="hub-section-heading">
        <div>
          <h2>Create a job</h2>
          <p>
            Choose a starting point. You’ll review each step before publishing.
          </p>
        </div>
      </div>
      <div className="hub-job-grid">
        <article className="hub-card">
          <h3>Start blank</h3>
          <p>Add your own job details and questions.</p>
          <button
            className="hub-button"
            onClick={() => choose({ kind: "blank" })}
          >
            Create blank job
          </button>
        </article>
        <article className="hub-card">
          <h3>Duplicate a job</h3>
          <p>
            Reuse an existing posting. Its applicants stay with the original.
          </p>
          <button
            className="hub-button secondary"
            disabled={!jobs.length}
            onClick={() => {
              setMode("duplicate");
              setPicked("");
            }}
          >
            Choose existing job
          </button>
        </article>
        <article className="hub-card">
          <h3>Use a saved template</h3>
          <p>Start with a reusable description, questions and scorecard.</p>
          <button
            className="hub-button secondary"
            onClick={() => {
              setMode("template");
              setPicked("");
            }}
          >
            Choose template
          </button>
        </article>
        <article className="hub-card">
          <h3>From a hiring request</h3>
          <p>Fill out a short request or turn a saved request into a job.</p>
          <button
            className="hub-button secondary"
            onClick={() => {
              setMode("request");
              setPicked("");
            }}
          >
            Open hiring requests
          </button>
        </article>
      </div>
      <Feedback error={mutation.error} />
      {mode === "duplicate" && (
        <section className="hub-card">
          <h3>Choose a job to duplicate</h3>
          <Field label="Existing job">
            <select value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Select a posting</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} ·{" "}
                  {j.location || j.archiveCountry || "Location not set"} ·{" "}
                  {j.status} · /{j.slug}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="hub-button"
            disabled={!picked}
            onClick={() =>
              choose({
                kind: "duplicate",
                source: jobs.find((j) => j.id === picked)!,
              })
            }
          >
            Use this job
          </button>
        </section>
      )}
      {mode === "template" && (
        <section className="hub-card">
          <h3>Choose a saved template</h3>
          {catalog.templates.length ? (
            <>
              <Field label="Job template">
                <select
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">Select a template</option>
                  {catalog.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="hub-button"
                disabled={!picked}
                onClick={() =>
                  choose({
                    kind: "template",
                    template: catalog.templates.find((t) => t.id === picked)!,
                  })
                }
              >
                Use this template
              </button>
            </>
          ) : (
            <>
              <p>
                No templates saved yet. Use “Save as template” on any job to
                keep its description, questions and scorecard for next time.
              </p>
              <button
                className="hub-button secondary"
                onClick={() => choose({ kind: "blank" })}
              >
                Start blank instead
              </button>
            </>
          )}
        </section>
      )}
      {mode === "request" && (
        <section className="hub-card">
          <h3>Hiring requests</h3>
          <p>
            A request records what you need to hire. Creating a job from it does
            not publish anything automatically.
          </p>
          {requests.some((r) => r.status === "pending") && (
            <>
              <Field label="Saved hiring request">
                <select
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">Select a request</option>
                  {requests
                    .filter((r) => r.status === "pending")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} · {publicLocation(r.location)}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                className="hub-button"
                disabled={!picked}
                onClick={() =>
                  choose({
                    kind: "request",
                    request: requests.find((r) => r.id === picked)!,
                  })
                }
              >
                Create job from request
              </button>
            </>
          )}
          <button
            className="hub-text-button"
            onClick={() => setNewRequest(!newRequest)}
          >
            {newRequest ? "Hide request form" : "Create a hiring request"}
          </button>
          {newRequest && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await mutation.run<SetupCatalog>(
                  "/api/job-setup",
                  "PATCH",
                  {
                    action: "request",
                    expectedRevision: revision,
                    title: requestTitle,
                    location,
                    description,
                    reason,
                  },
                  "Request saved.",
                );
                if (result) {
                  setRequests(result.requests);
                  setRevision(result.revision);
                  setPicked(result.requests.at(-1)!.id);
                  setNewRequest(false);
                }
              }}
            >
              <Field label="Requested job title">
                <input
                  required
                  maxLength={160}
                  value={requestTitle}
                  onChange={(e) => setRequestTitle(e.target.value)}
                />
              </Field>
              <LocationFields value={location} change={setLocation} />
              <Field label="Why do we need this hire?">
                <textarea
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Field label="Draft responsibilities (optional)">
                <textarea
                  maxLength={100000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <button className="hub-button" disabled={mutation.busy}>
                Save hiring request
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
export function JobWizard({
  job,
  start,
  jobs,
  catalog,
  scorecards,
  chooseStart,
  onChoose,
  cancel,
  done,
  onManageScorecards,
}: {
  job?: HubJob;
  start?: JobStart;
  jobs: HubJob[];
  catalog: SetupCatalog;
  scorecards: Catalog;
  chooseStart: boolean;
  onChoose: (s: JobStart) => void;
  cancel: () => void;
  done: (m: string) => void;
  onManageScorecards?: () => void;
}) {
  return (
    <>
      <div hidden={!chooseStart}>
        <StartChoices
          jobs={jobs}
          catalog={catalog}
          choose={onChoose}
          back={cancel}
        />
      </div>
      {(!chooseStart || start || job) && (
        <div hidden={chooseStart}>
          <Editor
            key={job?.id || JSON.stringify(start)}
            job={job}
            start={start || { kind: "blank" }}
            jobs={jobs}
            catalog={catalog}
            scorecards={scorecards}
            cancel={cancel}
            done={done}
            onManageScorecards={onManageScorecards}
          />
        </div>
      )}
    </>
  );
}

function Editor({
  job,
  start,
  jobs,
  catalog,
  scorecards,
  cancel,
  done,
  onManageScorecards,
}: {
  job?: HubJob;
  start: JobStart;
  jobs: HubJob[];
  catalog: SetupCatalog;
  scorecards: Catalog;
  cancel: () => void;
  done: (m: string) => void;
  onManageScorecards?: () => void;
}) {
  const source =
    job ||
    (start.kind === "duplicate"
      ? start.source
      : start.kind === "template"
        ? start.template.job
        : undefined);
  const request = start.kind === "request" ? start.request : undefined;
  const sourceLocation = job
    ? catalog.locations[job.id] || null
    : start.kind === "duplicate"
      ? catalog.locations[start.source.id] ||
        (/remote/i.test(start.source.location || "")
          ? inferredLocation(start.source)
          : null)
      : start.kind === "template"
        ? start.template.location
        : request?.location || {
            workModel: "remote" as const,
            country: "International",
            city: "",
          };
  const originalBinding = job
    ? scorecards.bindings[job.id]
    : start.kind === "duplicate"
      ? scorecards.bindings[start.source.id]
      : start.kind === "template"
        ? start.template.scorecard
        : undefined;
  const [reviewCatalog, setReviewCatalog] = useState(scorecards),
    [expectedBinding, setExpectedBinding] = useState(
      job ? scorecards.bindings[job.id] || null : null,
    );
  const canReuse =
    (originalBinding &&
      !scorecards.archived.includes(originalBinding.templateId)) ||
    (job && originalBinding);
  const highestValidatedStep = useRef(0);
  const [step, setStep] = useState(0),
    [title, setTitle] = useState(source?.title || request?.title || ""),
    [description, setDescription] = useState(
      source?.descriptionHtml || request?.description || "",
    ),
    [location, setLocation] = useState<WorkLocation | null>(sourceLocation),
    [fields, setFields] = useState<ApplicationField[]>(
      structuredClone(source?.fields.length ? source.fields : starter),
    ),
    [department, setDepartment] = useState(source?.department || ""),
    [customSlug, setCustomSlug] = useState<string | null>(job?.slug || null),
    [assessment, setAssessment] = useState(source?.assessmentPrompt || ""),
    [rules, setRules] = useState<Rule[]>(structuredClone(source?.rules || [])),
    [autoReject, setAutoReject] = useState(job?.autoReject || false),
    [rejection, setRejection] = useState(source?.rejectionTemplate || ""),
    [approved, setApproved] = useState(false),
    [rejectApproved, setRejectApproved] = useState(false),
    [choice, setChoice] = useState(
      canReuse
        ? `${originalBinding!.templateId}:${originalBinding!.version}`
        : "none",
    ),
    [rubric, setRubric] = useState<Rubric>({
      name: "",
      criteria: [{ label: "", weight: 1, anchors: [...defaultAnchors] }],
    }),
    [error, setError] = useState(""),
    [questionPreset, setQuestionPreset] = useState("");
  const [creationId] = useState(() => crypto.randomUUID());
  const mutation = useHubMutation();
  const [postingLabel] = useState(
    () => `${new Date().toISOString().slice(0, 10)} ${creationId.slice(0, 8)}`,
  );
  const hiringTeam = useJobTeam(job?.id);
  const archiveCountry =
      job?.archiveCountry || location?.country || "International",
    slug =
      customSlug ?? availableJobSlug(title, location?.country || "", "", jobs);
  const available = reviewCatalog.templates.filter(
    (t) =>
      !reviewCatalog.archived.includes(t.id) &&
      !reviewCatalog.templates.some(
        (v) => v.id === t.id && v.version > t.version,
      ),
  );
  const pin = job ? expectedBinding : canReuse ? originalBinding : null;
  const pinned = pin
    ? reviewCatalog.templates.find(
        (t) => t.id === pin.templateId && t.version === pin.version,
      )
    : undefined;
  useEffect(() => {
    const restore = () => {
      const value = new URLSearchParams(window.location.search).get("jobStep");
      if (value !== null && value !== "start") {
        const requested = Number(value);
        const next =
          Number.isSafeInteger(requested) && requested >= 0
            ? Math.min(highestValidatedStep.current, requested)
            : 0;
        setStep(next);
        setApproved(false);
        setRejectApproved(false);
        setError("");
        if (String(next) !== value) {
          const url = new URL(window.location.href);
          url.searchParams.set("jobStep", String(next));
          window.history.replaceState(window.history.state, "", url);
        }
      }
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("hub:navigate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hub:navigate", restore);
    };
  }, []);
  function goToStep(next: number) {
    if (next === step) return;
    highestValidatedStep.current = Math.max(highestValidatedStep.current, next);
    const url = new URL(window.location.href);
    url.searchParams.set("jobStep", String(next));
    window.history.pushState(
      { aiclHub: true, jobStepFrom: window.location.href },
      "",
      url,
    );
    setStep(next);
  }
  function next() {
    setError("");
    if (
      step === 0 &&
      (!title.trim() ||
        (!location && !job) ||
        (location && (!location.workModel || !location.country)) ||
        (location &&
          location.workModel !== "remote" &&
          (!location.city.trim() ||
            !location.country ||
            location.country === "International")))
    ) {
      setError(
        "Add a job title, then choose a work arrangement and location. Office-based jobs need a country and city.",
      );
      return;
    }
    if (step === 1) {
      const invalid = fields.find(
        (f) =>
          !f.title.trim() ||
          (["ValueSelect", "MultiValueSelect"].includes(f.type) &&
            !f.options?.length),
      );
      if (invalid) {
        setError(
          "Give each question a label and add choices to any choice question.",
        );
        return;
      }
      if (new Set(fields.map((f) => f.path)).size !== fields.length) {
        setError(
          "Two questions use the same identifier. Remove the duplicate question.",
        );
        return;
      }
    }
    if (
      step === 2 &&
      choice === "new" &&
      (!rubric.name.trim() ||
        rubric.criteria.some(
          (c) => !c.label.trim() || c.anchors.some((a) => !a.trim()),
        ))
    ) {
      setError(
        "Name your scorecard and add at least one review criterion. Keep or complete the standard rating descriptions.",
      );
      return;
    }
    goToStep(Math.min(3, step + 1));
  }
  function updateField(i: number, change: Partial<ApplicationField>) {
    setFields((v) => v.map((f, n) => (i === n ? { ...f, ...change } : f)));
    setApproved(false);
    setRejectApproved(false);
  }
  async function save(status: HubJob["status"]) {
    setError("");
    if (description.length > 100000) {
      setError(
        "The job description exceeds 100,000 characters including formatting. Shorten it before saving; your text has been preserved.",
      );
      setStep(0);
      return;
    }
    if (
      choice === "new" &&
      (!rubric.name.trim() || rubric.criteria.some((c) => !c.label.trim()))
    ) {
      setError(
        "Finish the scorecard name and criteria, or choose manual review before saving a draft.",
      );
      return;
    }
    if (rules.some((r) => ["Number", "Score"].includes(fields.find((f) => f.path === r.fieldPath)?.type || "") && (typeof r.value !== "number" || !Number.isFinite(r.value)))) {
      setError("Enter a number for every numeric screening rule, or remove the unfinished rule in Advanced rules.");
      setStep(1);
      return;
    }
    if (autoReject && !rules.some((r) => r.enabled)) {
      setError("Add an enabled qualifying answer, or turn off automatic rejection.");
      setStep(1);
      return;
    }
    if (status !== "closed" && autoReject && !rejectApproved) {
      setError(
        "Approve the enabled qualification rules and rejection email before saving automatic rejection.",
      );
      return;
    }
    if (status === "open" && (!approved || !hasDescriptionText(description))) {
      setError(
        "Add a job description and approve the final preview before publishing.",
      );
      return;
    }
    const binding =
      choice === "none" || choice === "new"
        ? null
        : {
            templateId: choice.split(":")[0],
            version: Number(choice.split(":")[1]),
          };
    const payload = {
      action: "save",
      creationId,
      ...(job ? { jobId: job.id, formVersion: job.formVersion } : {}),
      job: {
        title,
        slug,
        department,
        descriptionHtml: description,
        location: job?.location || "",
        status,
        fields,
        rules,
        autoReject,
        ...(rejection.trim() ? { rejectionTemplate: rejection } : {}),
        assessmentPrompt: assessment,
        archiveProject:
          job?.archiveProject ||
          (source?.archiveProject && source.archiveProject !== source.title
            ? source.archiveProject
            : title.slice(0, 120)),
        archiveCountry,
        hiringRound: job?.hiringRound || postingLabel,
      },
      location,
      expectedBinding,
      ...(hiringTeam.draft && hiringTeam.resource.data
        ? {
            hiringTeam: hiringTeam.draft,
            expectedTeamRevision:
              hiringTeam.resource.data.config?.revision ?? 0,
          }
        : {}),
      scorecard: binding,
      ...(choice === "new" ? { rubric } : {}),
      ...(request ? { requestId: request.id } : {}),
    };
    const result = await mutation.run<HubJob>(
      "/api/job-setup",
      "POST",
      payload,
      "",
    );
    if (result)
      done(
        status === "open"
          ? "Job published. Its public page is ready for applicants when intake is enabled."
          : status === "closed"
            ? "Job closed. Previous applicants and files remain saved."
            : "Draft saved. Reopen it whenever you’re ready to continue.",
      );
  }
  return (
    <section aria-labelledby="wizard-title">
      <button
        className="hub-text-button hub-back"
        disabled={mutation.busy}
        onClick={cancel}
      >
        <ArrowLeft size={16} /> Back to jobs
      </button>
      <div className="hub-section-heading">
        <div>
          <p className="hub-kicker">{job ? "EDIT JOB" : "CREATE JOB"}</p>
          <h2 id="wizard-title">{job ? job.title : "Set up your job"}</h2>
          <p>
            Step {step + 1} of 4 ·{" "}
            {
              [
                "Job details",
                "Application form",
                "Review scorecard",
                "Review and publish",
              ][step]
            }
          </p>
        </div>
      </div>
      {!job && source && (
        <p className="hub-notice">
          This is a new posting. Applicants from the original job stay saved
          there. Automatic rejection starts off.
        </p>
      )}
      <ol
        className="hub-wizard-steps"
        aria-label="Job setup progress"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          paddingLeft: "1.5rem",
        }}
      >
        {["Details", "Application", "Scorecard", "Publish"].map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}>
            <button
              type="button"
              className="hub-text-button"
              disabled={i > step || mutation.busy}
              onClick={() => {
                setApproved(false);
                setRejectApproved(false);
                goToStep(i);
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>
      <Feedback error={error || mutation.error} />
      {job && mutation.error.includes("assigned scorecard changed") && (
        <button
          className="hub-button secondary"
          disabled={mutation.busy}
          onClick={async () => {
            try {
              const fresh = await hubRequest<Catalog>("/api/scorecards");
              const binding = fresh.bindings[job.id] || null;
              setReviewCatalog(fresh);
              setExpectedBinding(binding);
              setChoice(
                binding ? `${binding.templateId}:${binding.version}` : "none",
              );
              setApproved(false);
              goToStep(2);
              mutation.clear();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not refresh scorecards.",
              );
            }
          }}
        >
          Review latest assignment
        </button>
      )}
      <fieldset disabled={mutation.busy}>
        {step === 0 && (
          <>
            <section className="hub-card">
              <h3>Tell applicants about the job</h3>
              <Field label="Job title">
                <input
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setApproved(false);
                  }}
                  placeholder="For example, Creative Strategist"
                />
              </Field>
              {job && !location && (
                <p className="hub-notice">
                  Current location:{" "}
                  {job.location || job.archiveCountry || "Not set"}. Keep it
                  unchanged, or choose a work arrangement below.
                </p>
              )}
              <LocationFields
                value={
                  location || {
                    workModel: "" as WorkLocation["workModel"],
                    country: job?.archiveCountry || "International",
                    city: "",
                  }
                }
                change={(v) => {
                  setLocation(v);
                  setApproved(false);
                }}
              />
              <Field
                label="Job description"
                hint="Use approved responsibilities and requirements. You can save a draft before this is ready."
              >
                <DescriptionEditor
                  data-field-control
                  disabled={mutation.busy}
                  value={description}
                  onChange={(value) => {
                    setDescription(value);
                    setApproved(false);
                  }}
                />
              </Field>
              <details>
                <summary>More details: department and page address</summary>
                <Field label="Department (optional)">
                  <input
                    maxLength={160}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </Field>
                <Field
                  label="Public page address"
                  hint="Changing an existing address breaks links shared earlier."
                >
                  <div className="hub-input-prefix">
                    <span>/jobs/</span>
                    <input
                      maxLength={160}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      value={slug}
                      onChange={(e) => setCustomSlug(e.target.value)}
                    />
                  </div>
                </Field>
              </details>
            </section>
            <section className="hub-card hub-job-team-panel">
              <h3>Who is hiring for this job?</h3>
              <ResourceState
                loading={hiringTeam.resource.loading}
                error={hiringTeam.resource.error}
                retry={() => void hiringTeam.resource.reload()}
              />
              {hiringTeam.resource.data && hiringTeam.draft && (
                <JobTeamFields
                  data={hiringTeam.resource.data}
                  value={hiringTeam.draft}
                  change={(value) => {
                    hiringTeam.setDraft(value);
                    setApproved(false);
                  }}
                />
              )}
              {hiringTeam.resource.error && (
                <p className="hub-muted">
                  Your job details are preserved. You can save the job and
                  configure its hiring team from Jobs later.
                </p>
              )}
            </section>
          </>
        )}
        {step === 1 && (
          <section className="hub-card">
            <h3>What should applicants send?</h3>
            <p>
              Name and email are always required. Choose Required or Optional
              for each extra field.
            </p>
            <div className="hub-editor-list">
              {fields.map((f, i) => (
                <article className="hub-question" key={f.path}>
                  <div className="hub-question-heading">
                    <strong>{f.title || "New question"}</strong>
                    <Badge>{f.required ? "Required" : "Optional"}</Badge>
                    {!f.path.startsWith("_systemfield_name") &&
                      !f.path.startsWith("_systemfield_email") && (
                        <button
                          type="button"
                          className="hub-icon-button"
                          aria-label={`Remove ${f.title || "new question"}`}
                          onClick={() => {
                            setFields((v) => v.filter((_, n) => n !== i));
                            setRules((v) =>
                              v.filter((r) => r.fieldPath !== f.path),
                            );
                            setApproved(false);
                            setRejectApproved(false);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                  </div>
                  {["_systemfield_name", "_systemfield_email"].includes(
                    f.path,
                  ) ? (
                    <p className="hub-muted">
                      Always required to identify and contact the applicant.
                    </p>
                  ) : (
                    <>
                      <div className="hub-form-grid">
                        <Field label={`Question ${i + 1} label`}>
                          <input
                            required
                            maxLength={160}
                            value={f.title}
                            onChange={(e) =>
                              updateField(i, { title: e.target.value })
                            }
                          />
                        </Field>
                        <Field label={`Question ${i + 1} requirement`}>
                          <select
                            value={f.required ? "required" : "optional"}
                            onChange={(e) =>
                              updateField(i, {
                                required: e.target.value === "required",
                              })
                            }
                          >
                            <option value="optional">
                              Optional — applicant can skip
                            </option>
                            <option value="required">
                              Required — applicant must answer
                            </option>
                          </select>
                        </Field>
                      </div>
                      <div>
                        <Field label={`Question ${i + 1} answer format`}>
                          <select
                            value={f.type}
                            disabled={rules.some((r) => r.fieldPath === f.path)}
                            onChange={(e) =>
                              updateField(i, {
                                type: e.target.value as FieldType,
                                options: undefined,
                              })
                            }
                          >
                            {Object.entries(formats).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {rules.some((r) => r.fieldPath === f.path) && <p className="hub-muted">Remove this question’s screening rules in Advanced rules before changing its answer format.</p>}
                        <Field
                          label={`Question ${i + 1} instructions (optional)`}
                        >
                          <textarea
                            rows={2}
                            value={f.description || ""}
                            onChange={(e) =>
                              updateField(i, { description: e.target.value })
                            }
                          />
                        </Field>
                      </div>
                      <QuestionScreening field={f} rules={rules} autoReject={autoReject} change={(value) => { setRules(value); setApproved(false); setRejectApproved(false); }} />
                      {["ValueSelect", "MultiValueSelect"].includes(f.type) && (
                        <ChoiceInput
                          key={f.path + f.type}
                          label={`Question ${i + 1} choices`}
                          options={f.options || []}
                          change={(options) => updateField(i, { options })}
                        />
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
            <div className="hub-form-grid">
              <Field label="Add from the question library">
                <select
                  value={questionPreset}
                  onChange={(e) => setQuestionPreset(e.target.value)}
                >
                  <option value="">Choose a question</option>
                  {experienceQuestions
                    .filter((q) => !fields.some((f) => f.path === q.path))
                    .map((q) => (
                      <option key={q.path} value={q.path}>
                        {q.title}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                type="button"
                className="hub-button secondary"
                disabled={!questionPreset || fields.length >= 100}
                onClick={() => {
                  const selected = experienceQuestions.find(
                    (q) => q.path === questionPreset,
                  );
                  if (selected)
                    setFields((v) => [
                      ...v,
                      {
                        ...structuredClone(selected),
                        title: selected.title.replace(/ \(optional\)$/i, ""),
                      },
                    ]);
                  setQuestionPreset("");
                  setRejectApproved(false);
                  setApproved(false);
                }}
              >
                Add selected question
              </button>
            </div>
            <button
              type="button"
              className="hub-button secondary"
              disabled={fields.length >= 100}
              onClick={() => {
                setFields((v) => [
                  ...v,
                  {
                    path: "question_" + crypto.randomUUID().slice(0, 8),
                    title: "",
                    type: "LongText",
                    required: false,
                  },
                ]);
                setApproved(false);
                setRejectApproved(false);
              }}
            >
              <Plus size={16} /> Add custom question
            </button>
            <AdvancedRules
              fields={fields}
              rules={rules}
              change={(value) => { setRules(value); setApproved(false); setRejectApproved(false); }}
              autoReject={autoReject}
              setAutoReject={setAutoReject}
              rejection={rejection}
              setRejection={setRejection}
              approved={rejectApproved}
              setApproved={setRejectApproved}
            />
            <p className="hub-muted">
              Profile links and experience answers are supplied by applicants.
              No LinkedIn login or scraping is used.
            </p>
          </section>
        )}
        {step === 2 && (
          <section className="hub-card">
            <h3>How will reviewers compare applicants?</h3>
            <p>
              Reviewers score job-related evidence from 1 to 5. Grades come from
              their scorecards; AI provides optional supporting evidence and
              does not rank or reject people.
            </p>
            <Field label="Review scorecard">
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="none">
                  Manual review — set up a scorecard later
                </option>
                {pinned &&
                  !available.some(
                    (t) => t.id === pinned.id && t.version === pinned.version,
                  ) && (
                    <option value={`${pinned.id}:${pinned.version}`}>
                      {pinned.name} · {job ? "current assigned" : "copied"}{" "}
                      version {pinned.version}
                    </option>
                  )}
                {available.map((t) => (
                  <option
                    key={`${t.id}:${t.version}`}
                    value={`${t.id}:${t.version}`}
                  >
                    {t.name} · version {t.version}
                  </option>
                ))}
                <option value="new">Create a reusable scorecard</option>
              </select>
            </Field>
            {choice === "new" && (
              <>
                <Field label="Scorecard name">
                  <input
                    required
                    maxLength={120}
                    value={rubric.name}
                    onChange={(e) =>
                      setRubric({ ...rubric, name: e.target.value })
                    }
                    placeholder="For example, Creative portfolio review"
                  />
                </Field>
                <p className="hub-muted">
                  Add the criteria your team has agreed to review. Equal weight
                  and the standard 1–5 scale are ready to use.
                </p>
                {rubric.criteria.map((c, i) => (
                  <article className="hub-question" key={i}>
                    <Field label={`Review criterion ${i + 1}`}>
                      <input
                        required
                        maxLength={180}
                        value={c.label}
                        onChange={(e) =>
                          setRubric({
                            ...rubric,
                            criteria: rubric.criteria.map((v, n) =>
                              n === i ? { ...v, label: e.target.value } : v,
                            ),
                          })
                        }
                        placeholder="An approved job-related criterion"
                      />
                    </Field>
                    <details>
                      <summary>
                        Customize weight and rating descriptions
                      </summary>
                      <Field label={`Criterion ${i + 1} weight`}>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={c.weight}
                          onChange={(e) =>
                            setRubric({
                              ...rubric,
                              criteria: rubric.criteria.map((v, n) =>
                                n === i
                                  ? { ...v, weight: Number(e.target.value) }
                                  : v,
                              ),
                            })
                          }
                        />
                      </Field>
                      {c.anchors.map((a, n) => (
                        <Field
                          key={n}
                          label={`Criterion ${i + 1} rating ${n + 1}`}
                        >
                          <input
                            required
                            maxLength={200}
                            value={a}
                            onChange={(e) =>
                              setRubric({
                                ...rubric,
                                criteria: rubric.criteria.map((v, x) =>
                                  x === i
                                    ? {
                                        ...v,
                                        anchors: v.anchors.map((b, y) =>
                                          y === n ? e.target.value : b,
                                        ) as typeof v.anchors,
                                      }
                                    : v,
                                ),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </details>
                    <button
                      type="button"
                      className="hub-text-button"
                      disabled={rubric.criteria.length === 1}
                      onClick={() =>
                        setRubric({
                          ...rubric,
                          criteria: rubric.criteria.filter((_, n) => n !== i),
                        })
                      }
                    >
                      Remove criterion
                    </button>
                  </article>
                ))}
                <button
                  type="button"
                  className="hub-button secondary"
                  disabled={rubric.criteria.length >= 8}
                  onClick={() =>
                    setRubric({
                      ...rubric,
                      criteria: [
                        ...rubric.criteria,
                        { label: "", weight: 1, anchors: [...defaultAnchors] },
                      ],
                    })
                  }
                >
                  Add review criterion
                </button>
              </>
            )}
            {choice !== "none" && choice !== "new" && (
              <ul>
                {reviewCatalog.templates
                  .find((t) => `${t.id}:${t.version}` === choice)
                  ?.criteria.map((c) => (
                    <li key={c.label}>
                      {c.label} · weight {c.weight}
                    </li>
                  ))}
              </ul>
            )}
            {onManageScorecards && (
              <p className="hub-muted">
                Manage saved scorecards in Settings. Save this draft before
                leaving the job setup.
              </p>
            )}
            <details>
              <summary>Optional: assessment instructions</summary>
              <Field label="Assessment instructions">
                <textarea
                  rows={6}
                  maxLength={20000}
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                />
              </Field>
              <p className="hub-muted">
                Recruiters send assessments after reviewing the application.
                Saving instructions sends no invitations.
              </p>
            </details>
          </section>
        )}
        {step === 3 && (
          <>
            <section className="hub-card">
              <h3>Ready to share?</h3>
              <h4>{title}</h4>
              <p>
                {location
                  ? publicLocation(location)
                  : job?.location || job?.archiveCountry}
              </p>
              <p className="hub-muted">Public page: /jobs/{slug}</p>
              <p>
                Hiring team:{" "}
                {hiringTeam.draft?.members.length
                  ? hiringTeam.draft.members.join(", ")
                  : "No team selected"}
              </p>
              <p>
                Applicant reply contact:{" "}
                {hiringTeam.draft?.replyTo ||
                  hiringTeam.resource.data?.sender ||
                  "Connected recruiting mailbox"}
              </p>
              <p>
                {fields.filter((f) => f.required).length} required fields ·{" "}
                {fields.filter((f) => !f.required).length} optional fields
              </p>
              <ul>
                {fields.map((f) => (
                  <li key={f.path}>
                    {f.title} — {f.required ? "Required" : "Optional"}
                  </li>
                ))}
              </ul>
              <p>
                Review:{" "}
                {choice === "none"
                  ? "Manual review"
                  : choice === "new"
                    ? rubric.name
                    : reviewCatalog.templates.find(
                        (t) => `${t.id}:${t.version}` === choice,
                      )?.name}
              </p>
              <details>
                <summary>Preview description</summary>
                <SafeDescription
                  html={description || "Add a description before publishing."}
                />
              </details>
              <label className="hub-checkbox">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />{" "}
                I have reviewed the job description, questions and review
                criteria.
              </label>
              <p className="hub-muted">
                A new posting keeps a separate set of applicants automatically.
                Earlier postings and files stay available; no batch names are
                needed.
              </p>
            </section>
            <section className="hub-card"><h3>Screening decisions</h3>{autoReject && <label className="hub-checkbox"><input type="checkbox" checked={rejectApproved} onChange={(e) => setRejectApproved(e.target.checked)} />I approve these requirements and the rejection email for automatic decisions.</label>}<p>{autoReject ? "Automatic rejection is on. Applicants who fail any enabled requirement are rejected and receive the rejection email." : "Automatic rejection is off. Every application goes to recruiter review."}</p><ul>{rules.filter((r) => r.enabled).map((r, i) => <li key={i}>{fields.find((f) => f.path === r.fieldPath)?.title}: {r.operator === "gte" ? "at least" : r.operator === "lte" ? "at most" : r.operator === "equals" ? "must equal" : r.operator === "not_equals" ? "must not equal" : "must contain"} {typeof r.value === "boolean" ? r.value ? "Yes" : "No" : String(r.value)}</li>)}</ul><button type="button" className="hub-text-button" onClick={() => goToStep(1)}>Edit questions and screening</button></section>
          </>
        )}
        <div className="hub-sticky-save">
          {step > 0 && <button
            type="button"
            className="hub-button secondary"
            disabled={step === 0}
            onClick={() => {
              setApproved(false);
              setRejectApproved(false);
              setError("");
              const previous = new URL(window.location.href);
              previous.searchParams.set("jobStep", String(step - 1));
              if (window.history.state?.jobStepFrom === previous.href)
                window.history.back();
              else goToStep(step - 1);
            }}
          >
            Back
          </button>}
          <button
            type="button"
            className="hub-button secondary"
            disabled={!title.trim() || (!location && !job)}
            onClick={() => void save("draft")}
          >
            {job?.status === "open"
              ? "Save as draft (unpublish)"
              : "Save draft"}
          </button>
          {step < 3 ? (
            <button type="button" className="hub-button" onClick={next}>
              Continue
            </button>
          ) : (
            <>
              <button
                type="button"
                className="hub-button"
                disabled={!approved || !hasDescriptionText(description)}
                onClick={() => void save("open")}
              >
                {mutation.busy
                  ? "Saving…"
                  : job?.status === "open"
                    ? "Save published job"
                    : "Publish job"}
              </button>
              {job && (
                <button
                  type="button"
                  className="hub-text-button"
                  onClick={() => void save("closed")}
                >
                  Close job
                </button>
              )}
            </>
          )}
          <button type="button" className="hub-text-button" onClick={cancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </section>
  );
}
function QuestionScreening({ field, rules, autoReject, change }: { field: ApplicationField; rules: Rule[]; autoReject: boolean; change: (rules: Rule[]) => void }) {
  const numeric = ["Number", "Score"].includes(field.type);
  if (!numeric && field.type !== "Boolean") return <p className="hub-muted">To add a minimum or a required Yes/No answer, choose Number or Yes/No as the answer format.</p>;
  const index = rules.findIndex((r) => r.fieldPath === field.path && r.operator === (numeric ? "gte" : "equals"));
  const rule = rules[index];
  function update(patch: Partial<Rule>) {
    if (rule) change(rules.map((r, i) => i === index ? { ...r, ...patch } : r));
    else change([...rules, { fieldPath: field.path, operator: numeric ? "gte" : "equals", value: numeric ? "" : true, enabled: true, reason: `Does not meet the requirement for ${field.title || "this question"}.`, ...patch }]);
  }
  return <section className="hub-screening-question" aria-label={`Screening for ${field.title || "new question"}`}>
    <label className="hub-checkbox"><input type="checkbox" checked={rule?.enabled || false} onChange={(e) => update({ enabled: e.target.checked })} />Set a qualifying answer</label>
    {rule?.enabled && <>
      <Field label={numeric ? `Minimum accepted number for ${field.title || "this question"}` : `Qualifying answer for ${field.title || "this question"}`} hint={numeric ? "Example: 7 accepts 7 or more; anything below 7 does not qualify." : "Applicants must choose this answer to qualify."}>
        {numeric ? <input type="number" step="any" value={String(rule.value)} onChange={(e) => update({ value: e.target.value.trim() === "" ? "" : Number(e.target.value) })} /> : <select value={String(rule.value)} onChange={(e) => update({ value: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select>}
      </Field>
      <p className="hub-muted">{autoReject ? "Answers that do not qualify trigger automatic rejection when these settings are approved and saved." : "Answers that do not qualify are flagged for recruiter review. Turn on automatic rejection below to reject them automatically."} {!field.required && "This question is optional: a missing answer goes to human review, not automatic rejection. Choose Required above to ensure everyone answers."}</p>
    </>}
    {rules.filter((r) => r.fieldPath === field.path).length > (rule ? 1 : 0) && <p className="hub-muted">This question also has additional rules. Review them under Advanced rules below; they are preserved.</p>}
  </section>;
}

function AdvancedRules({
  fields,
  rules,
  change,
  autoReject,
  setAutoReject,
  rejection,
  setRejection,
  approved,
  setApproved,
}: {
  fields: ApplicationField[];
  rules: Rule[];
  change: (v: Rule[]) => void;
  autoReject: boolean;
  setAutoReject: (v: boolean) => void;
  rejection: string;
  setRejection: (v: string) => void;
  approved: boolean;
  setApproved: (v: boolean) => void;
}) {
  function update(i: number, patch: Partial<Rule>) {
    change(rules.map((r, n) => (n === i ? { ...r, ...patch } : r)));
    setApproved(false);
  }
  return (
    <section className="hub-card">
      <h3>What happens when an applicant does not qualify?</h3>
      <p>
        Without approved rules, every applicant goes to human review. AI does
        not reject applicants.
      </p>
      <details><summary>Advanced rules ({rules.length})</summary>
      {rules.map((r, i) => (
        <article className="hub-question" key={i}>
          <Field label={`Requirement ${i + 1} question`}>
            <select
              value={r.fieldPath}
              onChange={(e) => {
                const f = fields.find((f) => f.path === e.target.value);
                update(i, {
                  fieldPath: e.target.value,
                  value:
                    f?.type === "Boolean"
                      ? false
                      : ["Number", "Score"].includes(f?.type || "")
                        ? 0
                        : "",
                });
              }}
            >
              {fields
                .filter((f) => f.type !== "File")
                .map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={`Requirement ${i + 1} comparison`}>
            <select
              value={r.operator}
              onChange={(e) =>
                update(i, { operator: e.target.value as Rule["operator"] })
              }
            >
              <option value="equals">Must equal</option>
              <option value="not_equals">Must not equal</option>
              <option value="contains">Must contain</option>
              <option value="gte">Must be at least</option>
              <option value="lte">Must be at most</option>
            </select>
          </Field>
          <Field label={`Requirement ${i + 1} expected answer`}>
            {typeof r.value === "boolean" ? (
              <select
                value={String(r.value)}
                onChange={(e) =>
                  update(i, { value: e.target.value === "true" })
                }
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                type={["Number", "Score"].includes(fields.find((f) => f.path === r.fieldPath)?.type || "") ? "number" : "text"}
                value={String(r.value)}
                onChange={(e) =>
                  update(i, {
                    value:
                      ["Number", "Score"].includes(fields.find((f) => f.path === r.fieldPath)?.type || "") && e.target.value.trim() !== ""
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
          </Field>
          <Field label={`Requirement ${i + 1} reason`}>
            <input
              maxLength={500}
              value={r.reason}
              onChange={(e) => update(i, { reason: e.target.value })}
            />
          </Field>
          <label className="hub-checkbox">
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
            />{" "}
            Enable requirement {i + 1}
          </label>
          <button
            className="hub-text-button"
            type="button"
            onClick={() => {
              change(rules.filter((_, n) => n !== i));
              setApproved(false);
            }}
          >
            Remove requirement
          </button>
        </article>
      ))}
      <button
        type="button"
        className="hub-button secondary"
        onClick={() =>
          change([
            ...rules,
            {
              fieldPath: fields.find((f) => f.type !== "File")?.path || "",
              operator: "equals",
              value: "",
              reason: "",
              enabled: false,
            },
          ])
        }
      >
        Add qualification rule
      </button></details>
      <Field
        label="Rejection email (optional)"
        hint="Leave blank to use the team’s saved email template."
      >
        <textarea
          rows={5}
          maxLength={10000}
          value={rejection}
          onChange={(e) => {
            setRejection(e.target.value);
            setApproved(false);
          }}
        />
      </Field>
      <label className="hub-checkbox">
        <input
          type="checkbox"
          checked={autoReject}
          onChange={(e) => {
            setAutoReject(e.target.checked);
            setApproved(false);
          }}
        />{" "}
        Automatically reject applicants who fail enabled requirements
      </label>
      {autoReject && (
        <label className="hub-checkbox">
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />{" "}
          I approve these requirements and the rejection email for automatic
          decisions.
        </label>
      )}
    </section>
  );
}

function ChoiceInput({
  label,
  options,
  change,
}: {
  label: string;
  options: NonNullable<ApplicationField["options"]>;
  change: (options: NonNullable<ApplicationField["options"]>) => void;
}) {
  const [text, setText] = useState(() =>
    options.map((o) => o.label).join("\n"),
  );
  return (
    <Field label={label} hint="One answer choice per line.">
      <textarea
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          change(
            e.target.value
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean)
              .map((v) => ({
                label: v,
                value: options.find((o) => o.label === v)?.value || v,
              })),
          );
        }}
      />
    </Field>
  );
}
