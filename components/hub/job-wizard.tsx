"use client";
import { countries, countryResidenceField, isCountryResidence, residencePath } from "@/lib/countries";
import { screeningValue, summarizeCountries } from "@/lib/job-setup/screening-summary";
import { DEFAULT_REJECTION } from "@/lib/hiring/email-templates";
import { CountryScreening } from "./country-screening";
import { ScreeningSummary } from "./screening-summary";
import { contactPaths, withRequiredContacts } from "@/lib/hiring/contact-fields";
import { reorderApplicationQuestions } from "@/lib/job-setup/question-order";
import { closestCenter, pointerWithin, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useJobRecovery } from "./job-recovery";
import { requestDraftNavigation } from "./draft-navigation";
import type { JobRecoveryState } from "@/lib/job-setup/drafts";
import { hasDescriptionText } from "@/lib/job-description";
import { DescriptionEditor } from "./description-editor";
import { SafeDescription } from "../careers/safe-description";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUp, ArrowDown, Plus, Trash2, Copy, FileText, ClipboardList, GripVertical } from "lucide-react";
import { hubRequest, useHubMutation } from "./api";
import { parseFormattedNumber } from "@/lib/hiring/number-format";
import { FormattedNumberInput } from "@/components/forms/formatted-number-input";
import { withRequiredResume, resumePath } from "@/lib/hiring/contact-fields";
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
    required: true,
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
            Start with what you already have. You can save and finish later.
          </p>
        </div>
      </div>
      <div className="hub-start-options" aria-label="Job starting point">
        <button className="hub-start-option" aria-label="Create blank job" onClick={() => choose({ kind: "blank" })}>
          <Plus size={20} /><span><strong>Start from scratch</strong><small>Add a title, description and questions.</small></span>
        </button>
        <button className="hub-start-option" aria-label="Choose existing job" disabled={!jobs.length} onClick={() => { setMode("duplicate"); setPicked(""); }}>
          <Copy size={20} /><span><strong>Duplicate an existing job</strong><small>Reuse its setup. Previous applicants stay saved.</small></span>
        </button>
        <button className="hub-start-option" aria-label="Choose template" onClick={() => { setMode("template"); setPicked(""); }}>
          <FileText size={20} /><span><strong>Use a template</strong><small>Start with a saved job setup.</small></span>
        </button>
        <button className="hub-start-option" aria-label="Open hiring requests" onClick={() => { setMode("request"); setPicked(""); }}>
          <ClipboardList size={20} /><span><strong>Use a hiring request</strong><small>Turn an internal request into a posting.</small></span>
        </button>
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
  active = true,
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
  active?: boolean;
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
      {!chooseStart && (
        <div hidden={chooseStart}>
          <Editor
            key={job?.id || JSON.stringify(start)}
            active={active && !chooseStart}
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

function questionRuleSummary(field:ApplicationField,rules:Rule[]) {
  const enabled=rules.filter(rule=>rule.fieldPath===field.path && rule.enabled);const rule=enabled[0];if(!rule)return "";
  const value=Array.isArray(rule.value)?(isCountryResidence(field)?summarizeCountries(rule.value).label:rule.value.map(value=>screeningValue(value,field)).join(", ")):screeningValue(rule.value,field);
  const labels:Record<string,string>={gte:"Minimum",lte:"Maximum",equals:"Must answer",not_equals:"Must not answer",contains:"Includes",in:"Only",not_in:"Excludes"};
  return `${labels[rule.operator]||"Requirement"} ${value || "not set"}${enabled.length>1?` · +${enabled.length-1} rules`:""}`;
}

const questionCollision: CollisionDetection = args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);
// Keyboard coordinates include scroll compensation; only constrain pointer movement.
const verticalQuestionDrag: Modifier = ({ transform, activatorEvent }) => activatorEvent?.type === "keydown" ? transform : ({ ...transform, x: 0 });

function SortableQuestion({ field, number, disabled, children }: {
  field: ApplicationField;
  number: number;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: field.path,
    disabled,
    data: { label: field.title || "New question", number },
  });
  return <article
    ref={setNodeRef}
    className={`hub-question${isDragging ? " hub-question-dragging" : ""}`}
    style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : undefined }}
    data-question-path={field.path}
  >
    {children(<button
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      className="hub-icon-button hub-question-drag-handle"
      disabled={disabled}
      style={{ touchAction: "none", cursor: disabled ? undefined : "grab", userSelect: "none" }}
      aria-label={`Reorder ${field.title || "new question"}`}
      title="Drag to reorder. Or press Space, use arrow keys, then Space to finish."
    ><GripVertical size={20} aria-hidden="true" /></button>)}
  </article>;
}

function Editor({
  active,
  job,
  start,
  jobs,
  catalog,
  scorecards,
  cancel,
  done,
  onManageScorecards,
}: {
  active: boolean;
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
  const defaultRejection = catalog.defaultRejectionTemplate?.trim() ? catalog.defaultRejectionTemplate : DEFAULT_REJECTION;
  const saveFeedback = useRef<HTMLDivElement>(null);
  const [expandedQuestion,setExpandedQuestion]=useState<string|null>(null);
  const [invalidInstructions,setInvalidInstructions]=useState<string|null>(null);
  const [showAdvancedRules,setShowAdvancedRules]=useState(false);
  const [step, setStep] = useState(0),
    [title, setTitle] = useState(source?.title || request?.title || ""),
    [description, setDescription] = useState(
      source?.descriptionHtml || request?.description || "",
    ),
    [location, setLocation] = useState<WorkLocation | null>(sourceLocation),
    [fields, setFields] = useState<ApplicationField[]>(
      withRequiredResume(withRequiredContacts(structuredClone(source?.fields.length ? source.fields : starter))),
    ),
    [department, setDepartment] = useState(source?.department || ""),
    [customSlug, setCustomSlug] = useState<string | null>(job?.slug || null),
    [assessment, setAssessment] = useState(source?.assessmentPrompt || ""),
    [rules, setRules] = useState<Rule[]>(structuredClone(source?.rules || [])),
    [autoReject, setAutoReject] = useState(job?.autoReject || false),
    [aiMatchEnabled, setAiMatchEnabled] = useState(job?.aiMatchEnabled || false),
    [rejection, setRejection] = useState(source?.rejectionTemplate || ""),
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
  const [creationId, setCreationId] = useState(() => crypto.randomUUID());
  const mutation = useHubMutation();
  const [draggedQuestion, setDraggedQuestion] = useState<string | null>(null);
  const questionSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }),
  );
  const [postingLabel, setPostingLabel] = useState(
    () => `${new Date().toISOString().slice(0, 10)} ${creationId.slice(0, 8)}`,
  );
  const hiringTeam = useJobTeam(job?.id);
  const [draftFormVersion, setDraftFormVersion] = useState(
    job?.formVersion ?? null,
  );
  const [draftTeamRevision, setDraftTeamRevision] = useState<number | null>(
    null,
  );
  const sourceId =
    start.kind === "duplicate"
      ? start.source.id
      : start.kind === "template"
        ? start.template.id
        : start.kind === "request"
          ? start.request.id
          : "";
  const recoveryState: JobRecoveryState = {
    title,
    description,
    location,
    fields,
    department,
    customSlug,
    assessment,
    rules,
    autoReject,
    aiMatchEnabled,
    rejection,
    choice,
    rubric,
    team: hiringTeam.draft,
    teamRevision:
      draftTeamRevision ?? hiringTeam.resource.data?.config?.revision ?? 0,
    expectedBinding,
    step,
    creationId,
    postingLabel,
    formVersion: draftFormVersion,
    startKind: start.kind,
    sourceId,
  };
  const recovery = useJobRecovery(
    job?.id || `new:${start.kind}:${sourceId}`,
    recoveryState,
    (draft) => {
      if (
        draft.formVersion === null &&
        jobs.some((saved) => saved.id === draft.creationId)
      )
        return false;
      setTitle(draft.title);
      setDescription(draft.description);
      setLocation(draft.location);
      setFields(withRequiredResume(withRequiredContacts(draft.fields)));
      setDepartment(draft.department);
      setCustomSlug(draft.customSlug);
      setAssessment(draft.assessment);
      setRules(draft.rules.map((r) => ({ ...r, value: r.value ?? "" })));
      setAutoReject(draft.autoReject);
      setAiMatchEnabled(draft.aiMatchEnabled || false);
      setRejection(draft.rejection);
      setChoice(draft.choice);
      setRubric(draft.rubric);
      hiringTeam.setDraft(draft.team);
      setDraftTeamRevision(draft.teamRevision);
      setExpectedBinding(draft.expectedBinding);
      setStep(draft.step);
      setCreationId(draft.creationId);
      setPostingLabel(draft.postingLabel);
      setDraftFormVersion(draft.formVersion);

      const url = new URL(window.location.href);
      url.searchParams.set("jobStep", String(draft.step));
      window.history.replaceState(window.history.state, "", url);
    },
    !!hiringTeam.draft,
    active,
  );
  const leaveEditor = () => requestDraftNavigation(cancel);

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
            ? Math.min(3, requested)
            : 0;
        setStep(next);

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
    const url = new URL(window.location.href);
    url.searchParams.set("jobStep", String(next));
    window.history.pushState(
      { aiclHub: true, jobStepFrom: window.location.href },
      "",
      url,
    );
    setStep(next);
  }
  function validateNumericScreening() {
    const incomplete = rules.find(
      (r) =>
        ["Number", "Score"].includes(
          fields.find((f) => f.path === r.fieldPath)?.type || "",
        ) &&
        (typeof r.value !== "number" || !Number.isFinite(r.value) || (fields.find(f=>f.path===r.fieldPath)?.numberFormat === "currency" && typeof parseFormattedNumber(String(r.value),true)!=="number")),
    );
    if (incomplete){
      setExpandedQuestion(incomplete.fieldPath);setShowAdvancedRules(true);
      setError(
        "Enter a number for every numeric screening rule, or remove the unfinished rule in Advanced rules.",
      );
    }
    return !incomplete;
  }
  useEffect(()=>{if(error || mutation.error){saveFeedback.current?.focus();saveFeedback.current?.scrollIntoView({block:"center",behavior:"instant"});}},[error,mutation.error]);
  function validateSection(section: number) {
    setError("");
    if (
      section === 0 &&
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
      return false;
    }
    if (section === 1) {
      const invalidCountry=rules.find(rule=>rule.enabled && ["in","not_in"].includes(rule.operator) && (!Array.isArray(rule.value) || !rule.value.length));
      if(invalidCountry){setExpandedQuestion(invalidCountry.fieldPath);setError("Select at least one country for each country screening rule, or choose Any country.");return false;}
      const longInstructions=fields.find(field=>(field.description?.length||0)>2000);
      if(longInstructions){setExpandedQuestion(longInstructions.path);setInvalidInstructions(longInstructions.path);setError("Keep question instructions within 2,000 characters.");return false;}
      if (!validateNumericScreening()) return false;
      const invalid = fields.find(
        (f) =>
          !f.title.trim() ||
          (["ValueSelect", "MultiValueSelect"].includes(f.type) &&
            !f.options?.length),
      );
      if (invalid) {
        setExpandedQuestion(invalid.path);
        setError(
          "Give each question a label and add choices to any choice question.",
        );
        return false;
      }
      if (new Set(fields.map((f) => f.path)).size !== fields.length) {
        setExpandedQuestion(fields.find((field,index)=>fields.findIndex(item=>item.path===field.path)!==index)?.path||null);
        setError(
          "Two questions use the same identifier. Remove the duplicate question.",
        );
        return false;
      }
    }
    if (
      section === 2 &&
      choice === "new" &&
      (!rubric.name.trim() ||
        rubric.criteria.some(
          (c) => !c.label.trim() || c.anchors.some((a) => !a.trim()),
        ))
    ) {
      setError(
        "Name your scorecard and add at least one review criterion. Keep or complete the standard rating descriptions.",
      );
      return false;
    }
    return true;
  }
  function next() {
    setError("");goToStep(Math.min(3,step+1));
  }
  function updateField(i: number, change: Partial<ApplicationField>) {
    setFields((v) => v.map((f, n) => (i === n ? { ...f, ...change } : f)));

  }
  async function save(status: HubJob["status"]) {
    if(mutation.busy || !recovery.ready)return;
    setError("");
    for(const section of (status!=="draft"?[0,1,2]:[1])){if(!validateSection(section)){goToStep(section);return;}}
    if (description.length > 100000) {
      setError(
        "The job description exceeds 100,000 characters including formatting. Shorten it before saving; your text has been preserved.",
      );
      goToStep(0);
      return;
    }
    if (
      choice === "new" &&
      (!rubric.name.trim() || rubric.criteria.some((c) => !c.label.trim()))
    ) {
      setError(
        "Finish the optional scorecard, or choose No manual scorecard to continue with AI review only.",
      );
      goToStep(2);
      return;
    }
    if (!validateNumericScreening()) {
      goToStep(1);
      return;
    }
    if (autoReject && !rules.some((r) => r.enabled)) {
      setError(
        "Add an enabled qualifying answer, or turn off automatic rejection.",
      );
      goToStep(1);
      return;
    }
    if (status === "open" && !hasDescriptionText(description)) {
      setError("Add a job description before publishing.");
      goToStep(0);
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
      ...(job
        ? { jobId: job.id, formVersion: draftFormVersion ?? job.formVersion, expectedLifecycleRevision: job.lifecycle?.revision || 0 }
        : {}),
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
        aiMatchEnabled,
        rejectionTemplate: rejection.trim() ? rejection : defaultRejection,
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
              draftTeamRevision ??
              hiringTeam.resource.data.config?.revision ??
              0,
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
    if (result) {
      recovery.complete();
      const cleared = await recovery.clear();
      done(
        (job && status === job.status ? `Changes saved. This job is still ${status === "open" ? "open" : status === "closed" ? "paused" : "a draft"}.` : status === "open"
          ? "Job published. Its public page is ready for applicants when intake is enabled."
          : status === "closed"
            ? "Job closed. Previous applicants and files remain saved."
            : "Draft saved. Reopen it whenever you’re ready to continue.") +
          (cleared
            ? ""
            : " The job saved successfully, but its private recovery copy could not be removed. An older copy will not replace the latest saved job."),
      );
    }
  }
  return (
    <section className="hub-job-editor" aria-labelledby="wizard-title">
      {recovery.dialog}
      <div className="hub-draft-status" role="status">
        <span>{recovery.message}</span>
        {recovery.ready && (
          <button
            type="button"
            className="hub-text-button"
            disabled={recovery.busy || mutation.busy}
            onClick={() => void recovery.save()}
          >
            {recovery.busy ? "Saving draft…" : "Save progress now"}
          </button>
        )}
      </div>
      {recovery.error && (
        <p role="alert" className="hub-notice">
          {recovery.error}
          {!recovery.ready && (
            <button
              type="button"
              className="hub-text-button"
              onClick={recovery.retry}
            >
              Retry loading draft
            </button>
          )}
        </p>
      )}

      <button
        className="hub-text-button hub-back"
        disabled={mutation.busy}
        onClick={leaveEditor}
      >
        <ArrowLeft size={16} /> Back to jobs
      </button>
      <div className="hub-section-heading hub-job-editor-heading">
        <div className="hub-job-editor-title">
          <p className="hub-kicker">{job ? "EDIT JOB" : "CREATE JOB"}</p>
          <h2 id="wizard-title">{job ? job.title : "Set up your job"}</h2>
          <p>
            {!job && <>Step {step + 1} of 4 · </>}
            {
              [
                "Job details",
                "Application questions",
                "Review settings",
                "Preview & publish",
              ][step]
            }
          </p>
        </div>
        <div className="hub-job-editor-actions" role="group" aria-label="Job save actions">
          <button type="button" className={"hub-button"+(step===3 && job?.status!=="open"?" secondary":"")} disabled={mutation.busy || !recovery.ready} onClick={()=>void save(job?.status||"draft")}>{mutation.busy?"Saving…":job?"Save changes":"Save draft job"}</button>
          {step===3 && job?.status!=="open" && <button type="button" className="hub-button" disabled={mutation.busy || !recovery.ready} onClick={()=>void save("open")}>Publish job</button>}
          <button type="button" className="hub-text-button" disabled={mutation.busy} onClick={leaveEditor}>Cancel</button>
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
      >
        {["Job details", "Application questions", "Review settings", "Preview & publish"].map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}>
            <button
              type="button"
              className="hub-text-button"
              disabled={mutation.busy || !recovery.ready}
              onClick={() => {

                goToStep(i);
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>
      <div ref={saveFeedback} tabIndex={-1}><Feedback error={error || mutation.error} /></div>
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
      <fieldset disabled={mutation.busy || !recovery.ready}>
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

                }}
              />
              <Field
                label="Job description"
                hint="Describe responsibilities and requirements. These also guide AI matching."
              >
                <DescriptionEditor
                  data-field-control
                  disabled={mutation.busy || !recovery.ready}
                  value={description}
                  onChange={(value) => {
                    setDescription(value);

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

          </>
        )}
        {step === 1 && (
          <section className="hub-card">
            <h3>What should applicants send?</h3>
            <div className="hub-required-contacts">
              <strong>Contact details included</strong>
              <span>First name · Last name · Email · Phone number</span>
              <span className="hub-muted">Required on every application.</span>
            </div>
            {fields.some(field => field.type === "Phone" && !contactPaths.includes(field.path)) && <p className="hub-muted">This form also has an extra phone question. The required Phone number field already collects it; you can remove the extra question below if it is a duplicate. Existing application answers are kept.</p>}
            <p className="hub-muted hub-question-order-help">Drag to reorder. Select a question to edit.</p>
            <DndContext
              sensors={questionSensors}
              collisionDetection={questionCollision}
              modifiers={[verticalQuestionDrag]}
              accessibility={{
                screenReaderInstructions: { draggable: "To reorder a question, press Space or Enter. Use the up and down arrow keys to move it. Press Space or Enter to finish, or Escape to cancel." },
                announcements: {
                  onDragStart: ({ active }) => `Picked up ${active.data.current?.label || "question"}.`,
                  onDragOver: ({ active, over }) => over ? `${active.data.current?.label || "Question"} is at position ${over.data.current?.number} of ${fields.length - contactPaths.length}.` : undefined,
                  onDragEnd: ({ active, over }) => over ? `${active.data.current?.label || "Question"} moved to position ${over.data.current?.number}.` : "Question order unchanged.",
                  onDragCancel: () => "Reordering cancelled. Question order unchanged.",
                },
              }}
              onDragStart={({ active }) => setDraggedQuestion(String(active.id))}
              onDragCancel={() => setDraggedQuestion(null)}
              onDragEnd={({ active, over }) => {
                setDraggedQuestion(null);
                if (over) setFields(current => reorderApplicationQuestions(current, String(active.id), String(over.id)));
              }}
            >
            <SortableContext items={fields.filter(field => !contactPaths.includes(field.path)).map(field => field.path)} strategy={verticalListSortingStrategy}>
            <div className="hub-editor-list">
              {fields.map((f, i) => contactPaths.includes(f.path) ? null : (
                <SortableQuestion key={f.path} field={f} number={i - contactPaths.length + 1} disabled={mutation.busy || !recovery.ready}>
                  {(handle) => <>
                  <div className="hub-question-heading hub-question-row-heading">
                    {handle}
                    {f.path===resumePath ? <div className="hub-question-row-title"><strong>{f.title}</strong><span className="hub-question-row-meta">File · Required</span></div> : <button type="button" className="hub-question-edit-toggle" aria-label={`${expandedQuestion===f.path?"Close":"Edit"} ${f.title||"new question"}`} aria-expanded={expandedQuestion===f.path} aria-controls={`question-editor-${f.path}`} onClick={()=>setExpandedQuestion(current=>current===f.path?null:f.path)}><span className="hub-question-row-title"><strong>{f.title||"New question"}</strong><span className="hub-question-row-meta">{formats[f.type]} · {f.required?"Required":"Optional"}{questionRuleSummary(f,rules) && ` · ${questionRuleSummary(f,rules)}`}</span></span><span className="hub-question-edit-label">{expandedQuestion===f.path?"Close":"Edit"}</span></button>}
                    <div className="hub-question-row-actions" hidden={f.path!==resumePath && expandedQuestion!==f.path}>
                      <button type="button" className="hub-icon-button" aria-label={`Move ${f.title||"new question"} up`} disabled={i<=contactPaths.length} onClick={()=>setFields(current=>reorderApplicationQuestions(current,f.path,current[i-1]?.path||""))}><ArrowUp size={16}/></button>
                      <button type="button" className="hub-icon-button" aria-label={`Move ${f.title||"new question"} down`} disabled={i===fields.length-1} onClick={()=>setFields(current=>reorderApplicationQuestions(current,f.path,current[i+1]?.path||""))}><ArrowDown size={16}/></button>
                      {f.path!==resumePath && <button type="button" className="hub-icon-button" aria-label={`Remove ${f.title||"new question"}`} onClick={()=>{setFields(current=>current.filter(field=>field.path!==f.path));setRules(current=>current.filter(rule=>rule.fieldPath!==f.path));setExpandedQuestion(null);}}><Trash2 size={16}/></button>}
                    </div>
                  </div>
                  {f.path!==resumePath && <div className="hub-question-editor" id={`question-editor-${f.path}`} hidden={expandedQuestion!==f.path}>
                    <>
                      <div className="hub-form-grid hub-question-fields">
                        <Field label={`Question ${i - contactPaths.length + 1} label`}>
                          <input
                            required
                            maxLength={160}
                            value={f.title}
                            disabled={f.path===resumePath}
                            onChange={(e) =>
                              updateField(i, { title: e.target.value })
                            }
                          />
                        </Field>
                        <Field label={`Question ${i - contactPaths.length + 1} requirement`}>
                          <select
                            value={f.required ? "required" : "optional"}
                            disabled={
                              f.path === resumePath || f.required &&
                              rules.some(
                                (r) =>
                                  r.fieldPath === f.path &&
                                  r.enabled &&
                                  ((["Number", "Score"].includes(f.type) &&
                                    r.operator === "gte") ||
                                    (f.type === "Boolean" &&
                                      r.operator === "equals") || (isCountryResidence(f) && ["in","not_in"].includes(r.operator))),
                              )
                            }
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
                        <Field label={`Question ${i - contactPaths.length + 1} answer format`}>
                          <select
                            value={f.type}
                            disabled={f.path===resumePath || isCountryResidence(f) || rules.some((r) => r.fieldPath === f.path)}
                            onChange={(e) =>
                              updateField(i, {
                                type: e.target.value as FieldType,
                                options: undefined,
                                numberFormat: undefined,
                                currency: undefined,
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
                      </div>
                      <div>
                        {f.type === "Number" && <Field label={`Question ${i-contactPaths.length+1} number display`}><select value={f.numberFormat||"number"} onChange={event=>updateField(i,event.target.value==="currency"?{numberFormat:"currency",currency:"USD"}:{numberFormat:"number",currency:undefined})}><option value="number">Number</option><option value="currency">Currency (USD)</option></select></Field>}
                        {f.path===resumePath && <p className="hub-muted">A résumé/CV is required for every application.</p>}
                        {isCountryResidence(f) ? <p className="hub-muted">This preset uses the complete country list. Choose eligible countries below; remove the question if you no longer need it.</p> : rules.some((r) => r.fieldPath === f.path) && (
                          <p className="hub-muted">
                            Remove screening rules before changing the answer format.
                          </p>
                        )}
                        <details className="hub-question-instructions" open={invalidInstructions===f.path?true:undefined}>
                          <summary>{f.description ? "Edit instructions (optional)" : "Add instructions (optional)"}</summary>
                        <Field
                          label={`Question ${i - contactPaths.length + 1} instructions (optional)`}
                        >
                          <textarea
                            rows={2}
                            value={f.description || ""}
                            onChange={(e) =>
                              updateField(i, { description: e.target.value })
                            }
                          />
                        </Field>
                        </details>
                      </div>
                      {isCountryResidence(f) && <CountryScreening field={f} rules={rules} change={setRules} requireAnswer={()=>updateField(i,{required:true})} autoReject={autoReject}/>}
                      <QuestionScreening
                        requireAnswer={() => updateField(i, { required: true })}
                        field={f}
                        rules={rules}
                        autoReject={autoReject}
                        change={(value) => {
                          setRules(value);

                        }}
                      />
                      {["ValueSelect", "MultiValueSelect"].includes(f.type) && !isCountryResidence(f) && (
                        <ChoiceInput
                          key={f.path + f.type}
                          label={`Question ${i - contactPaths.length + 1} choices`}
                          options={f.options || []}
                          change={(options) => updateField(i, { options })}
                        />
                      )}
                    </>
                  </div>}
                  </>}
                </SortableQuestion>
              ))}
            </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {draggedQuestion && <div className="hub-question hub-question-drag-preview" style={{ display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 24px #173e4430", background: "white" }}>
                <GripVertical size={20} aria-hidden="true" />
                <strong>{fields.find(field => field.path === draggedQuestion)?.title || "New question"}</strong>
              </div>}
            </DragOverlay>
            </DndContext>
            <button type="button" className="hub-button secondary" style={{marginBlock:"16px"}} disabled={fields.length>=100 || fields.some(field=>field.path===residencePath)} onClick={()=>{setFields([...fields,countryResidenceField()]);setExpandedQuestion(residencePath);}}>Add country of residence question</button>
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
                  if (selected){
                    setExpandedQuestion(selected.path);
                    setFields((v) => [
                      ...v,
                      {
                        ...structuredClone(selected),
                        title: selected.title.replace(/ \(optional\)$/i, ""),
                      },
                    ]);
                  }
                  setQuestionPreset("");

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
                const path="question_" + crypto.randomUUID().slice(0,8);setExpandedQuestion(path);
                setFields((v) => [
                  ...v,
                  {
                    path,
                    title: "",
                    type: "LongText",
                    required: true,
                  },
                ]);

              }}
            >
              <Plus size={16} /> Add custom question
            </button>
            <AdvancedRules
              reveal={showAdvancedRules}
              fields={fields}
              rules={rules}
              change={(value) => {
                setRules(value);

              }}
              autoReject={autoReject}
              setAutoReject={setAutoReject}
              defaultRejection={defaultRejection}
              rejection={rejection}
              setRejection={setRejection}
            />
            <p className="hub-muted">
              Profile links and experience answers are supplied by applicants.
              No LinkedIn login or scraping is used.
            </p>
          </section>
        )}
        {step === 2 && (
          <section className="hub-card">
            <h3>Find the strongest matches for this job</h3>
            <p>Compare resumes and application answers against this job’s requirements.</p>
            <label className="hub-checkbox hub-ai-match-choice">
              <input type="checkbox" checked={aiMatchEnabled}
                onChange={(e) => setAiMatchEnabled(e.target.checked)} />
              <span><strong>Rank applicants with AI</strong>
                <span className="hub-ai-match-help">A match score, a short summary, strengths and gaps for each applicant.</span>
              </span>
            </label>
            <p className="hub-muted">Your team chooses who moves forward. Minimum-answer screening rules work separately.</p>
            <details className="hub-review-explainer">
              <summary>How AI matching works</summary>
              <p>OpenAI, connected through OpenRouter, compares resume text and answers with the job description. Scores appear after processing. Missing or unreadable information is clearly marked. AI does not reject applicants.</p>
              <p>The company’s AI connection is managed in Settings.</p>
            </details>
            <details className="hub-review-team">
              <summary>Hiring team and notifications <span className="hub-muted">{hiringTeam.draft?.members.length ? `· ${hiringTeam.draft.members.length} selected` : "· no team selected"}</span></summary>
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

                  }}
                />
              )}
              {hiringTeam.resource.error && (
                <p className="hub-muted">
                  Your job details are preserved. You can save the job and
                  configure its hiring team from Jobs later.
                </p>
              )}
            </details>
            <details className="hub-optional-scorecard" open={choice === "new" ? true : undefined}>
              <summary>Optional: manual reviewer scorecard</summary>
              <p className="hub-muted">For teams that also want to record interview or portfolio ratings. This does not control the AI match score.</p>
            <Field label="Review scorecard">
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="none">
                  No manual scorecard
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
            </details>
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
            <section className="hub-card hub-publish-overview">
              <h3>Ready to share?</h3>
              <h4>{title || "Untitled job"}</h4>
              <p className="hub-muted hub-publish-url">Public page: /jobs/{slug}</p>
              <dl className="hub-publish-facts">
                <div><dt>Location</dt><dd>{location ? publicLocation(location) : job?.location || job?.archiveCountry || "Not set"}</dd></div>
                <div><dt>Hiring team</dt><dd>{hiringTeam.draft?.members.length ? hiringTeam.draft.members.join(", ") : "No team selected"}</dd></div>
                <div><dt>Application questions</dt><dd>{fields.filter(f => f.required).length} required · {fields.filter(f => !f.required).length} optional</dd></div>
                <div><dt>AI applicant matching</dt><dd>{aiMatchEnabled ? "Enabled after saving" : "Off"}</dd></div>
              </dl>
              <details className="hub-publish-details">
                <summary>Preview application questions</summary>
                <ul className="hub-publish-question-list">{fields.map(f => <li key={f.path}><span>{f.title}</span><Badge>{f.required ? "Required" : "Optional"}</Badge></li>)}</ul>
              </details>
              <p hidden={choice === "none"}>
                Optional reviewer scorecard:{" "}
                {choice === "none"
                  ? "None"
                  : choice === "new"
                    ? rubric.name
                    : reviewCatalog.templates.find(
                        (t) => `${t.id}:${t.version}` === choice,
                      )?.name}
              </p>
              <details className="hub-publish-details">
                <summary>Preview description</summary>
                <SafeDescription
                  html={description || "Add a description before publishing."}
                />
              </details>
            </section>
            <section className="hub-card">
              <h3>Automatic screening</h3>
              <p>
                {autoReject
                  ? "On — complete answers below your minimums receive the rejection email. Missing screening answers stay in the recruiter queue."
                  : "Off — applicants enter your New queue for the team to review."}
              </p>
              <ScreeningSummary rules={rules} fields={fields} />
              <button
                type="button"
                className="hub-text-button"
                onClick={() => goToStep(1)}
              >
                Edit questions and screening
              </button>
            </section>
          </>
        )}
        <nav className="hub-job-section-navigation" aria-label="Job section navigation">
          <button type="button" className="hub-button secondary" disabled={step===0} onClick={()=>{setError("");goToStep(Math.max(0,step-1));}}>Back</button>
          {step<3 && <button type="button" className="hub-button secondary" onClick={next}>Continue</button>}
        </nav>
      </fieldset>
    </section>
  );
}
function QuestionScreening({
  field,
  rules,
  autoReject,
  change,
  requireAnswer,
}: {
  requireAnswer: () => void;
  field: ApplicationField;
  rules: Rule[];
  autoReject: boolean;
  change: (rules: Rule[]) => void;
}) {
  const numeric = ["Number", "Score"].includes(field.type);
  if (!numeric && field.type !== "Boolean") return null;
  const index = rules.findIndex(
    (r) =>
      r.fieldPath === field.path && r.operator === (numeric ? "gte" : "equals"),
  );
  const rule = rules[index];
  function update(patch: Partial<Rule>) {
    if (rule)
      change(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    else
      change([
        ...rules,
        {
          fieldPath: field.path,
          operator: numeric ? "gte" : "equals",
          value: numeric ? "" : true,
          enabled: true,
          reason: `Does not meet the requirement for ${field.title || "this question"}.`,
          ...patch,
        },
      ]);
  }
  return (
    <section
      className="hub-screening-question"
      aria-label={`Screening for ${field.title || "new question"}`}
    >
      <label className="hub-checkbox">
        <input
          type="checkbox"
          checked={rule?.enabled || false}
          onChange={(e) => {
            if (e.target.checked) {
              requireAnswer();
              update({ enabled: true });
            } else if (rule && rule.value === "") {
              change(rules.filter((_, i) => i !== index));
            } else update({ enabled: false });
          }}
        />
        Set a qualifying answer
      </label>
      {rule?.enabled && (
        <>
          <Field
            label={
              numeric
                ? `Minimum accepted number for ${field.title || "this question"}`
                : `Qualifying answer for ${field.title || "this question"}`
            }
            hint={
              numeric
                ? "Enter the minimum, for example 7 or 30,000. Lower answers do not qualify."
                : "Applicants must choose this answer to qualify."
            }
          >
            {numeric ? (
              <FormattedNumberInput data-field-control={true} value={rule.value as number|string} currency={field.numberFormat==="currency"} onValueChange={value=>update({value})}/>

            ) : (
              <select
                value={String(rule.value)}
                onChange={(e) => update({ value: e.target.value === "true" })}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            )}
          </Field>
          <p className="hub-muted">
            {autoReject
              ? "Non-qualifying answers will trigger automatic rejection after saving."
              : "Non-qualifying answers go to recruiter review."}{" "}
            {!field.required &&
              "Missing optional answers go to review."}
          </p>
        </>
      )}
      {rules.filter((r) => r.fieldPath === field.path).length >
        (rule ? 1 : 0) && (
        <p className="hub-muted">
          This question also has additional rules. Review them under Advanced
          rules below; they are preserved.
        </p>
      )}
    </section>
  );
}

function AdvancedRules({
  defaultRejection,
  reveal=false,
  fields,
  rules,
  change,
  autoReject,
  setAutoReject,
  rejection,
  setRejection,
}: {
  defaultRejection: string;
  reveal?:boolean;
  fields: ApplicationField[];
  rules: Rule[];
  change: (v: Rule[]) => void;
  autoReject: boolean;
  setAutoReject: (v: boolean) => void;
  rejection: string;
  setRejection: (v: string) => void;
}) {
  function update(i: number, patch: Partial<Rule>) {
    change(rules.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  }
  const [editingRejection, setEditingRejection] = useState(false);
  const [rejectionInput, setRejectionInput] = useState("");
  return (
    <section className="hub-card hub-screening-decisions">
      <h3>What happens when an applicant does not qualify?</h3>
      <p>
        Automatic rejection runs only when you turn it on and save enabled requirements. AI does
        not reject applicants.
      </p>
      <details open={reveal?true:undefined}>
        <summary>Advanced rules ({rules.length})</summary>
        {rules.map((r, i) => (
          <article className="hub-question" key={i}>
            <Field label={`Requirement ${i + 1} question`}>
              <select
                value={r.fieldPath}
                disabled={["in","not_in"].includes(r.operator)}
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
                disabled={["in","not_in"].includes(r.operator)}
                onChange={(e) =>
                  update(i, { operator: e.target.value as Rule["operator"] })
                }
              >
                {["in","not_in"].includes(r.operator) && <option value={r.operator}>{r.operator === "in"?"Must be in allowed countries":"Must not be in excluded countries"}</option>}
                <option value="equals">Must equal</option>
                <option value="not_equals">Must not equal</option>
                <option value="contains">Must contain</option>
                <option value="gte">Must be at least</option>
                <option value="lte">Must be at most</option>
              </select>
            </Field>
            <Field label={`Requirement ${i + 1} expected answer`}>
              {Array.isArray(r.value) ? <p>{r.value.length} selected countries. Edit the country list on its question above.</p> : typeof r.value === "boolean" ? (
                <select
                  value={String(r.value)}
                  onChange={(e) =>
                    update(i, { value: e.target.value === "true" })
                  }
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : ["Number","Score"].includes(fields.find(f=>f.path===r.fieldPath)?.type||"") ? <FormattedNumberInput data-field-control={true} value={r.value as number|string} currency={fields.find(f=>f.path===r.fieldPath)?.numberFormat==="currency"} onValueChange={value=>update(i,{value})}/> : (
                <input
                  type="text"
                  value={String(r.value)}
                  onChange={(e) =>
                    update(i, {
                      value:
                        ["Number", "Score"].includes(
                          fields.find((f) => f.path === r.fieldPath)?.type ||
                            "",
                        ) && e.target.value.trim() !== ""
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
        </button>
      </details>
      <Field
        label="Rejection email"
        hint="Ready to use. {{name}} and {{jobTitle}} are filled in automatically. Customize this job’s message if needed."
      >
        <textarea
          rows={5}
          maxLength={10000}
          value={editingRejection ? rejectionInput : (rejection.trim() ? rejection : defaultRejection)}
          onFocus={(event) => { setRejectionInput(event.currentTarget.value); setEditingRejection(true); }}
          onBlur={() => setEditingRejection(false)}
          onChange={(e) => {
            setRejectionInput(e.target.value);
            setRejection(e.target.value);
          }}
        />
      </Field>
      <button type="button" className="hub-text-button" disabled={!rejection.trim() || rejection === defaultRejection} onClick={() => { setRejection(""); setEditingRejection(false); }}>Use default rejection message</button>
      <label className="hub-checkbox">
        <input
          type="checkbox"
          checked={autoReject}
          onChange={(e) => {
            setAutoReject(e.target.checked);

          }}
        />{" "}
        Automatically reject applicants who fail enabled requirements
      </label>
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
