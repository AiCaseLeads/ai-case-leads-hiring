import { HiringError, UncertainSubmissionError } from "./errors";
import type { ApplicationField, ApplicationInput, FieldType, HiringProvider, Job, JobDefinition, SubmissionOutcome, UploadHandle, UploadInput } from "./types";

const TYPES = new Set<FieldType>(["String", "Email", "File", "Date", "Number", "Boolean", "LongText", "ValueSelect", "MultiValueSelect", "Phone", "SocialLink", "Score", "Url"]);
type JsonRecord = Record<string, unknown>;
function object(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!)); }
export function jobSlug(id: string, title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "role"}--${id}`;
}
export function publicJob(value: unknown, now = Date.now()): Job | null {
  if (!object(value) || typeof value.id !== "string" || typeof value.title !== "string" || value.status !== "Published" || value.isListed !== true) return null;
  if (typeof value.applicationDeadline === "string" && (!Number.isFinite(Date.parse(value.applicationDeadline)) || Date.parse(value.applicationDeadline) <= now)) return null;
  // Provider HTML is not trusted browser markup. Use the documented plain description.
  const plain = typeof value.descriptionPlain === "string" ? value.descriptionPlain : "";
  return { id: value.id, slug: jobSlug(value.id, value.title), title: value.title, department: typeof value.departmentName === "string" ? value.departmentName : "", location: typeof value.locationName === "string" ? value.locationName : undefined, descriptionHtml: plain.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") };
}

export function normalizeForm(definition: unknown): { fields: ApplicationField[]; formUnavailable?: string } {
  if (!object(definition) || !Array.isArray(definition.sections)) return { fields: [], formUnavailable: "This application form is not configured yet." };
  const fields: ApplicationField[] = [];
  let unsupported = false;
  for (const section of definition.sections) {
    if (!object(section) || !Array.isArray(section.fields)) { unsupported = true; continue; }
    for (const entry of section.fields) {
      if (!object(entry) || !object(entry.field)) { unsupported = true; continue; }
      const field = entry.field;
      if (typeof field.path !== "string" || typeof field.title !== "string" || typeof entry.isRequired !== "boolean" || !TYPES.has(field.type as FieldType) || entry.visibilityCondition != null) { unsupported = true; continue; }
      let options: ApplicationField["options"];
      if (field.type === "ValueSelect" || field.type === "MultiValueSelect") {
        if (!Array.isArray(field.selectableValues) || field.selectableValues.some(v => !object(v) || typeof v.value !== "string" || typeof v.label !== "string")) { unsupported = true; continue; }
        options = field.selectableValues as { value: string; label: string }[];
      }
      fields.push({ path: field.path, title: field.title, type: field.type as FieldType, required: entry.isRequired, ...(options ? { options } : {}), ...(typeof entry.descriptionPlain === "string" ? { description: entry.descriptionPlain } : {}) });
    }
  }
  if (new Set(fields.map(f => f.path)).size !== fields.length || !fields.length) unsupported = true;
  return { fields, ...(unsupported ? { formUnavailable: "This application form requires additional configuration before applications can open." } : {}) };
}

/** Official 2026-01-01 API shapes. Never call this client from browser components. */
export class AshbyClient implements HiringProvider {
  private apiKey: string;
  private requestFetch: typeof fetch;
  private timeoutMs: number;
  constructor(apiKey: string, requestFetch: typeof fetch = fetch, timeoutMs = 12000) {
    this.apiKey = apiKey; this.requestFetch = requestFetch; this.timeoutMs = timeoutMs;
  }
  private async request(endpoint: string, body: unknown, writing = false): Promise<unknown> {
    const attempts = writing ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try {
        response = await this.requestFetch(`https://api.ashbyhq.com/${endpoint}`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${this.apiKey}:`)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs), redirect: "error" });
      } catch {
        if (writing) throw new UncertainSubmissionError();
        throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable. Please try again shortly.");
      }
      if (response.status === 429 || response.status >= 500) {
        if (writing) throw new UncertainSubmissionError();
        if (attempt + 1 < attempts) {
          const retry = Number(response.headers.get("retry-after") || 1);
          if (Number.isFinite(retry) && retry >= 0 && retry <= 3) { await new Promise(resolve => setTimeout(resolve, retry * 1000)); continue; }
        }
        throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable. Please try again shortly.");
      }
      if (!response.ok) throw new HiringError("provider_rejected", response.status === 401 || response.status === 403 ? 503 : 422, "We could not process this request. Please try again later.");
      let data: unknown;
      try { data = await response.json(); }
      catch { if (writing) throw new UncertainSubmissionError(); throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable."); }
      if (!object(data) || typeof data.success !== "boolean") { if (writing) throw new UncertainSubmissionError(); throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable."); }
      if (data.success !== true) throw new HiringError("provider_validation", 422, "Your application could not be submitted. Check your answers and try again.");
      return data.results;
    }
    throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable.");
  }
  async listJobs(): Promise<Job[]> {
    const result = await this.request("jobPosting.list", { listedOnly: true, includeUnpublishedJobPostings: false });
    if (!Array.isArray(result)) throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable.");
    return result.map(item => publicJob(item)).filter((job): job is Job => job !== null);
  }
  async jobInfo(jobPostingId: string): Promise<JobDefinition> {
    const result = await this.request("jobPosting.info", { jobPostingId, includeUnpublishedJobPostings: false });
    const job = publicJob(result);
    if (!job || !object(result)) throw new HiringError("job_closed", 404, "This job is no longer accepting applications.");
    return { job, ...normalizeForm(result.applicationFormDefinition) };
  }
  async createUpload(input: UploadInput): Promise<UploadHandle> {
    const result = await this.request("file.createFileUploadHandle", { fileUploadContext: "ApplicationForm", filename: input.filename, contentType: input.contentType, contentLength: input.contentLength });
    if (!object(result) || typeof result.url !== "string" || typeof result.handle !== "string" || !object(result.fields) || Object.values(result.fields).some(v => typeof v !== "string")) throw new HiringError("upload_unavailable", 503, "We could not prepare your upload. Please try again.");
    let url: URL;
    try { url = new URL(result.url); } catch { throw new HiringError("upload_unavailable", 503, "We could not prepare your upload."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new HiringError("upload_unavailable", 503, "We could not prepare your upload.");
    return { url: result.url, handle: result.handle, fields: result.fields as Record<string, string> };
  }
  async submit(input: ApplicationInput): Promise<SubmissionOutcome> {
    const result = await this.request("applicationForm.submit", { jobPostingId: input.jobPostingId, applicationForm: { fieldSubmissions: input.fieldSubmissions }, ...(input.utmData ? { utmData: input.utmData } : {}), allowSubmissionForUnpublishedJobPosting: false }, true);
    if (!object(result) || !object(result.formMessages) || typeof result.formMessages.blocked !== "boolean") throw new UncertainSubmissionError();
    if (result.formMessages.blocked) return { blocked: true };
    if (!object(result.submittedFormInstance) || typeof result.submittedFormInstance.id !== "string") throw new UncertainSubmissionError();
    return { blocked: false, submittedFormInstanceId: result.submittedFormInstance.id };
  }
  async resolveApplicationId(submittedFormInstanceId: string): Promise<string> {
    const result = await this.request("application.info", { submittedFormInstanceId });
    if (!object(result) || typeof result.id !== "string") throw new HiringError("provider_unavailable", 503, "Hiring information is temporarily unavailable.");
    return result.id;
  }
}
