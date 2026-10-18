"use client";
import { isCountryResidence } from "@/lib/countries";
import { CountryPicker } from "./country-picker";
import { SecurityCheck } from "./security-check";
import { captureAttribution } from "./attribution";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  FileText,
  LoaderCircle,
  LockKeyhole,
  UploadCloud,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CareerJob, CareerField } from "./types";
import { isWebsiteField, websiteLinkError } from "@/lib/hiring/website-links";
import { internationalPhoneError } from "@/lib/hiring/contact-fields";

type Value = string | number | boolean | string[] | { score: number };
export type Payload = {
  jobPostingId: string;
  fieldSubmissions: { path: string; value: Value }[];
  utmData: Record<string, string>;
  submissionKey: string;
  formVersion?: number;
};
const maxFileSize = 10 * 1024 * 1024;
const maxApplicationFileSize = 25 * 1024 * 1024;
const acceptedTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function ApplicationForm({
  job,
  fields,
  enabled,
  mode,
  formVersion,
}: {
  job: CareerJob;
  fields: CareerField[];
  enabled: boolean;
  mode?: string;
  formVersion?: number;
}) {
  const [values, setValues] = useState<Record<string, Value>>({}),
    [files, setFiles] = useState<Record<string, File>>({}),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [recoverable, setRecoverable] = useState(false),
    [restored, setRestored] = useState(false),
    [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const submissionKey = useRef<string>(""),
    pendingPayload = useRef<Payload | null>(null),
    inFlight = useRef(false);
  const [securityToken, setSecurityToken] = useState("");
  const [securityRefresh, setSecurityRefresh] = useState(0);
  const verification = useRef<{grant:string;expiresAt:number}|null>(null);
  const recoveryKey = `aicl:submission:${job.id}`;
  // Restore UI from an external browser recovery journal before enabling writes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(recoveryKey);
      if (saved) {
        const state = JSON.parse(saved) as {
          payload?: Payload;
          receipt?: string;
        };
        if (state.receipt) {
          window.location.replace(`/applications/${encodeURIComponent(state.receipt)}`);
          setUncertain(true);
        } else if (
          state.payload?.jobPostingId === job.id &&
          state.payload.submissionKey &&
          Array.isArray(state.payload.fieldSubmissions)
        ) {
          pendingPayload.current = state.payload;
          setRecoverable(true);
          submissionKey.current = state.payload.submissionKey;
          setValues(
            Object.fromEntries(
              state.payload.fieldSubmissions
                .filter(
                  (answer) =>
                    !fields.some(
                      (field) =>
                        field.path === answer.path && field.type === "File",
                    ),
                )
                .map((answer) => [answer.path, answer.value]),
            ),
          );
          setUncertain(true);
          setError(
            "An earlier submission is awaiting confirmation. Check its status here before starting another application.",
          );
        } else {
          setRecoveryUnavailable(true);
          setError(
            "Your saved submission status could not be read. Please contact the hiring team before submitting again.",
          );
        }
      }
    } catch {
      setRecoveryUnavailable(true);
      setError(
        "Your browser couldn’t recover submission status. Please enable site storage or contact the hiring team before submitting.",
      );
    }
    setRestored(true);
  }, [job.id, recoveryKey, fields]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const change = (path: string, value: Value) => {
    setValues((v) => ({ ...v, [path]: value }));
    setErrors((e) => ({ ...e, [path]: "" }));
  };
  const chooseFile = (path: string, file?: File) => {
    if (!file) return;
    if (file.size > maxFileSize) {
      setErrors((e) => ({
        ...e,
        [path]: "Please choose a file smaller than 10 MB.",
      }));
      return;
    }
    if (!acceptedTypes.includes(file.type)) {
      setErrors((e) => ({
        ...e,
        [path]: "Please upload a PDF, DOC, or DOCX file.",
      }));
      return;
    }
    if (Object.entries(files).reduce((sum, [key, current]) => sum + (key === path ? 0 : current.size), file.size) > maxApplicationFileSize) {
      setErrors((e) => ({ ...e, [path]: "Keep all application files within 25 MB total." }));
      return;
    }
    setFiles((f) => ({ ...f, [path]: file }));
    setErrors((e) => ({ ...e, [path]: "" }));
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((!enabled && !(uncertain && pendingPayload.current)) || !restored || recoveryUnavailable || inFlight.current)
      return;
    setError("");
    const invalid: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.path];
      if (
        field.required &&
        (field.type === "File"
          ? !files[field.path]
          : value === undefined ||
            value === "" ||
            (Array.isArray(value) && value.length === 0))
      )
        invalid[field.path] = "Please complete this field.";
      if (isWebsiteField(field) && value !== undefined && value !== "") {
        const linkError = websiteLinkError(value, field);
        if (linkError) invalid[field.path] = linkError;
      }
      if (field.type === "Phone" && value !== undefined && value !== "") {
        const phoneError = internationalPhoneError(value);
        if (phoneError) invalid[field.path] = phoneError;
      }
    }
    if (!uncertain && Object.keys(invalid).length) {
      setErrors(invalid);
      setError("Please check the highlighted fields.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    let attemptedSubmission = false;
    try {
      if (!submissionKey.current) submissionKey.current = crypto.randomUUID();
      if (!uncertain && (!verification.current || verification.current.expiresAt < Date.now())) {
        if (!securityToken) throw new Error("Please complete the security check before continuing.");
        if (securityToken === "disabled") verification.current = {grant:"",expiresAt:Date.now()+60000};
        else {
          const check = await fetch("/api/application-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:securityToken,submissionKey:submissionKey.current,jobId:job.id})});
          const checked = await check.json() as {grant:string;expiresAt:number};
          setSecurityToken(""); setSecurityRefresh(value=>value+1);
          if(!check.ok) throw new Error(readMessage(checked,"Security verification failed. Please try again."));
          verification.current = checked;
        }
      }
      let payload = pendingPayload.current;
      if (!payload) {
        const answers: { path: string; value: Value }[] = [];
        for (const field of fields) {
          if (field.type === "File") {
            const file = files[field.path];
            if (!file) continue;
            setStatus("Uploading your resume and files…");
            const uploadResponse = await fetch("/api/uploads", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-application-verification": verification.current?.grant || "", "x-submission-key": submissionKey.current },
              body: JSON.stringify({
                jobPostingId: job.id,
                fieldPath: field.path,
                filename: file.name,
                contentType: file.type,
                contentLength: file.size,
              }),
            });
            const signed = (await uploadResponse.json()) as {
              url: string;
              fields: Record<string, string>;
              handle: string;
            };
            if (!uploadResponse.ok)
              throw new Error(
                readMessage(
                  signed,
                  "We couldn’t prepare your upload. Your answers are still here.",
                ),
              );
            const formData = new FormData();
            formData.append("Content-Type", file.type);
            for (const [key, value] of Object.entries(signed.fields || {}))
              formData.append(key, String(value));
            formData.append("file", file);
            const uploaded = await fetch(signed.url, {
              method: "POST",
              body: formData,
            });
            if (!uploaded.ok)
              throw new Error(
                "Your file upload didn’t finish. Please try again; your answers are still here.",
              );
            answers.push({ path: field.path, value: signed.handle });
          } else {
            const value = values[field.path];
            if (value !== undefined && value !== "")
              answers.push({ path: field.path, value });
          }
        }
        const utmData = captureAttribution();
        payload = {
          jobPostingId: job.id,
          fieldSubmissions: answers,
          utmData,
          submissionKey: submissionKey.current,
          ...(formVersion?{formVersion}:{}),
        };
        pendingPayload.current = payload;
        setRecoverable(true);
      }
      setStatus(
        uncertain ? "Checking your submission…" : "Sending your application…",
      );
      // This is a browser recovery journal, never an authoritative application.
      // Persist before POST so reloads cannot silently mint a new submission key.
      try {
        sessionStorage.setItem(recoveryKey, JSON.stringify({ payload, jobTitle: job.title, jobSlug: job.slug }));
      } catch {
        throw new Error(
          "Your browser couldn’t save submission status. Please enable site storage before trying again.",
        );
      }
      attemptedSubmission = true;
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-application-verification": verification.current?.grant || "", "x-submission-key": submissionKey.current },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        status?: string;
        receipt?: string;
        error?: { fieldErrors?: Record<string, string> };
        message?: string;
      };
      if (response.ok && body.status === "accepted" && typeof body.receipt === "string" && body.receipt) {
        try {
          sessionStorage.setItem(
            recoveryKey,
            JSON.stringify({ receipt: body.receipt, jobTitle: job.title, jobSlug: job.slug }),
          );
        } catch { /* The authoritative receipt remains valid even if browser storage becomes unavailable. */ }
        // Full navigation guarantees a confirmed receipt after client-side role navigation in Vinext.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/applications/${encodeURIComponent(body.receipt)}`);
        return;
      }
      if (
        body.status === "pending" ||
        body.status === "uncertain" ||
        response.status === 202
      ) {
        setUncertain(true);
        setError(
          "We’re checking whether your application was received. Please check its status here before starting another application.",
        );
        return;
      }
      if (!response.ok) {
        if (response.status === 403) {
          verification.current = null;
          setSecurityToken(""); setSecurityRefresh(value=>value+1);
          attemptedSubmission = false; setUncertain(false);
        }
        // Only a confirmed validation rejection is safe to edit and retry with a new key.
        if ([400, 404, 413, 422].includes(response.status)) {
          if (body.error?.fieldErrors) setErrors(body.error.fieldErrors);
          pendingPayload.current = null;
          setRecoverable(false);
          submissionKey.current = "";
          sessionStorage.removeItem(recoveryKey);
          setUncertain(false);
          attemptedSubmission = false;
        }
        throw new Error(
          readMessage(
            body,
            "We couldn’t confirm your application. Please check its status before trying again.",
          ),
        );
      }
      if (body.status === "blocked") {
        setUncertain(true);
        setError(
          readMessage(
            body,
            "This submission can’t proceed. Please check your application status with the hiring team.",
          ),
        );
        return;
      }
      setUncertain(true);
      setError(
        "We couldn’t confirm your application. Please check its status here before submitting again.",
      );
    } catch (caught) {
      if (attemptedSubmission) setUncertain(true);
      setError(
        attemptedSubmission
          ? "We couldn’t confirm whether your application was received. Check its status here before submitting again."
          : caught instanceof SyntaxError
            ? "We couldn’t read the upload response. Your answers are still here; please try again."
            : caught instanceof Error
              ? caught.message
              : "Something went wrong. Your answers are still here.",
      );
    } finally {
      setBusy(false);
      setStatus("");
      inFlight.current = false;
    }
  }
  return (
    <form className="application-form" onSubmit={submit} noValidate>
      <div className="form-topline">
        <span className="form-top-icon">
          <FileText size={20} />
        </span>
        <span>YOUR NEXT CHAPTER</span>
      </div>
      <h2>Tell us about yourself.</h2>
      <p className="form-intro">
        Start with your experience. We’ll take it from there.
      </p>
      {!enabled && (
        <div className="form-notice">
          <AlertCircle size={18} />
          <div>
            <strong>{mode === "preview" ? "Application form preview" : "Applications are paused"}</strong>
            <p>
              {mode === "preview"
                ? "You can explore the fields below. This preview does not send applications."
                : uncertain && recoverable
                  ? "New applications are paused. You can still check whether your earlier submission was received."
                  : "Submissions are not being collected right now. Please check back later."}
            </p>
          </div>
        </div>
      )}
      <fieldset
        disabled={busy || uncertain || !restored || recoveryUnavailable}
        className="form-fields"
      >
        {fields.map((field) => (
          <div
            key={field.path}
            className={`form-field ${errors[field.path] ? "field-error" : ""}`}
          >
            <label htmlFor={field.path}>
              {field.title}
              {field.required && (
                <span className="required-mark" aria-label="required">
                  {" "}
                  *
                </span>
              )}
            </label>
            {field.description && (
              <p className="field-description" id={`${field.path}-help`}>
                {field.description}
              </p>
            )}
            {field.type === "File" ? (
              <div className="file-control">
                {files[field.path] ? (
                  <div className="chosen-file">
                    <FileText size={22} />
                    <span>
                      {files[field.path].name}
                      <small>
                        {(files[field.path].size / 1024).toFixed(0)} KB
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${field.title}`}
                      onClick={() =>
                        setFiles((f) => {
                          const next = { ...f };
                          delete next[field.path];
                          return next;
                        })
                      }
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <label className="file-drop" htmlFor={field.path}>
                    <UploadCloud size={26} />
                    <strong>Choose a file</strong>
                    <span>PDF, DOC, DOCX · Up to 10 MB each · 25 MB total</span>
                    <input
                      id={field.path}
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={(e) =>
                        chooseFile(field.path, e.target.files?.[0])
                      }
                      aria-invalid={!!errors[field.path]}
                      aria-describedby={
                        [
                          field.description && `${field.path}-help`,
                          errors[field.path] && `${field.path}-error`,
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    />
                  </label>
                )}
              </div>
            ) : field.type === "LongText" ? (
              <Textarea
                id={field.path}
                value={String(values[field.path] ?? "")}
                onChange={(e) => change(field.path, e.target.value)}
                rows={4}
                maxLength={20000}
                aria-invalid={!!errors[field.path]}
                aria-describedby={
                  [
                    field.description && `${field.path}-help`,
                    errors[field.path] && `${field.path}-error`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              />
            ) : field.type === "Boolean" ? (
              <RadioGroup
                id={field.path}
                aria-label={field.title}
                aria-describedby={
                  [
                    field.description && `${field.path}-help`,
                    errors[field.path] && `${field.path}-error`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                value={
                  values[field.path] === undefined
                    ? ""
                    : String(values[field.path])
                }
                onValueChange={(value) => change(field.path, value === "true")}
                className="boolean-options"
              >
                <label>
                  <RadioGroupItem value="true" />
                  Yes
                </label>
                <label>
                  <RadioGroupItem value="false" />
                  No
                </label>
              </RadioGroup>
            ) : isCountryResidence(field) ? (
              <CountryPicker field={field} value={String(values[field.path] ?? "")} onChange={value=>change(field.path,value)} error={errors[field.path]}/>
            ) : field.type === "ValueSelect" ? (
              <Select
                value={String(values[field.path] ?? "")}
                onValueChange={(value) => change(field.path, value)}
              >
                <SelectTrigger
                  id={field.path}
                  className="form-select"
                  aria-invalid={!!errors[field.path]}
                  aria-describedby={
                    [
                      field.description && `${field.path}-help`,
                      errors[field.path] && `${field.path}-error`,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                >
                  <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options || []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "Score" ? (
              <Select
                value={
                  values[field.path] &&
                  typeof values[field.path] === "object" &&
                  !Array.isArray(values[field.path])
                    ? String((values[field.path] as { score: number }).score)
                    : ""
                }
                onValueChange={(value) =>
                  change(field.path, { score: Number(value) })
                }
              >
                <SelectTrigger
                  id={field.path}
                  className="form-select"
                  aria-invalid={!!errors[field.path]}
                  aria-describedby={
                    [
                      field.description && `${field.path}-help`,
                      errors[field.path] && `${field.path}-error`,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                >
                  <SelectValue placeholder="Select a rating" />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "MultiValueSelect" ? (
              <div
                className="multi-options"
                id={field.path}
                role="group"
                aria-label={field.title}
                aria-describedby={
                  [
                    field.description && `${field.path}-help`,
                    errors[field.path] && `${field.path}-error`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                {(field.options || []).map((option) => {
                  const selected = Array.isArray(values[field.path])
                    ? (values[field.path] as string[])
                    : [];
                  return (
                    <label key={option.value}>
                      <Checkbox
                        checked={selected.includes(option.value)}
                        onCheckedChange={(checked) =>
                          change(
                            field.path,
                            checked
                              ? [...selected, option.value]
                              : selected.filter((v) => v !== option.value),
                          )
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Input
                id={field.path}
                placeholder={isWebsiteField(field) ? "https://…" : field.type === "Phone" ? "+1 305 555 0123" : undefined}
                onBlur={() => {
                  if (!isWebsiteField(field) && field.type !== "Phone") return;
                  const value = values[field.path];
                  const message = value === undefined || value === "" ? "" : (field.type === "Phone" ? internationalPhoneError(value) : websiteLinkError(value, field)) || "";
                  setErrors(current => ({ ...current, [field.path]: message }));
                }}
                type={
                  field.type === "Email"
                    ? "email"
                    : field.type === "Phone"
                      ? "tel"
                      : ["SocialLink", "Url"].includes(field.type)
                        ? "url"
                        : field.type === "Date"
                          ? "date"
                          : ["Number", "Score"].includes(field.type)
                            ? "number"
                            : "text"
                }
                value={String(values[field.path] ?? "")}
                onChange={(e) =>
                  change(
                    field.path,
                    ["Number", "Score"].includes(field.type) &&
                      e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
                autoComplete={
                  field.type === "Email"
                    ? "email"
                    : field.type === "Phone"
                      ? "tel"
                      : field.path === "_systemfield_name"
                        ? "name"
                        : "off"
                }
                maxLength={20000}
                aria-invalid={!!errors[field.path]}
                aria-describedby={
                  [
                    field.description && `${field.path}-help`,
                    errors[field.path] && `${field.path}-error`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              />
            )}
            {errors[field.path] && (
              <p className="field-error-message" id={`${field.path}-error`}>
                {errors[field.path]}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      {(enabled || uncertain) && <SecurityCheck onToken={setSecurityToken} refresh={securityRefresh} />}
      {error && (
        <div className="submit-error" role="alert">
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      )}
      <button
        className="button ink submit-button"
        type="submit"
        disabled={(!enabled && !(uncertain && recoverable)) || busy || !restored || recoveryUnavailable}
      >
        {busy ? (
          <>
            <LoaderCircle className="spin" size={18} />
            {status}
          </>
        ) : uncertain ? (
          "Check submission status"
        ) : enabled ? (
          "Submit application"
        ) : (
          mode === "preview" ? "Preview only — sending disabled" : "Applications are paused"
        )}
      </button>
      <p className="form-privacy">
        <LockKeyhole size={14} />
        <span>
          Your information is used for recruiting.{" "}
          <a href="/privacy">Applicant privacy</a>
        </span>
      </p>
    </form>
  );
}
function readMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const b = body as { message?: unknown; error?: unknown };
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "string") return b.error;
  if (
    b.error &&
    typeof b.error === "object" &&
    "message" in b.error &&
    typeof b.error.message === "string"
  )
    return b.error.message;
  return fallback;
}
