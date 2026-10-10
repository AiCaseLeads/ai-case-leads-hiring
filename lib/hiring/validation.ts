import { HiringError } from "./errors";
import type { ApplicationField, ApplicationInput, UploadInput } from "./types";

const UTM_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": ["pdf"], "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "text/plain": ["txt"], "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
};
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_APPLICATION_FILE_BYTES = 25 * 1024 * 1024;
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function badRequest(message = "Please check the application details and try again."): never { throw new HiringError("invalid_request", 400, message); }
export function parseApplication(value: unknown): ApplicationInput {
  if (!object(value) || typeof value.jobPostingId !== "string" || !UUID.test(value.jobPostingId) || typeof value.submissionKey !== "string" || !UUID.test(value.submissionKey) || !Array.isArray(value.fieldSubmissions) || value.fieldSubmissions.length > 100) badRequest();
  const fields = value.fieldSubmissions;
  if(value.formVersion!==undefined&&(typeof value.formVersion!=="number"||!Number.isSafeInteger(value.formVersion)||value.formVersion<1))badRequest("The application form version is invalid. Refresh this page.");
  if (fields.some(f => !object(f) || typeof f.path !== "string" || !f.path || f.path.length > 256 || !("value" in f)) || new Set(fields.map(f => f.path)).size !== fields.length) badRequest();
  let utmData: ApplicationInput["utmData"];
  if (value.utmData != null) {
    if (!object(value.utmData) || Object.entries(value.utmData).some(([k, v]) => !UTM_KEYS.has(k) || (v !== null && (typeof v !== "string" || v.length > 500)))) badRequest();
    utmData = value.utmData as ApplicationInput["utmData"];
  }
  return { jobPostingId: value.jobPostingId, submissionKey: value.submissionKey, fieldSubmissions: fields as ApplicationInput["fieldSubmissions"], ...(utmData ? { utmData } : {}),...(typeof value.formVersion==="number"?{formVersion:value.formVersion}:{}) };
}
export function parseUpload(value: unknown): UploadInput {
  if (!object(value) || typeof value.jobPostingId !== "string" || !UUID.test(value.jobPostingId) || typeof value.fieldPath !== "string" || !value.fieldPath || value.fieldPath.length > 256 || typeof value.filename !== "string" || !value.filename || value.filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(value.filename) || typeof value.contentType !== "string" || typeof value.contentLength !== "number" || !Number.isSafeInteger(value.contentLength) || value.contentLength < 1 || value.contentLength > MAX_FILE_BYTES) badRequest("Upload a supported file up to 10 MB.");
  const extension = value.filename.toLowerCase().split(".").at(-1)!;
  if (!MIME_EXTENSIONS[value.contentType]?.includes(extension)) badRequest("Upload a PDF, Word document, text file, JPG, PNG, or WebP file.");
  return value as UploadInput;
}
export function validateAnswers(input: ApplicationInput, fields: ApplicationField[]): void {
  const definitions = new Map(fields.map(field => [field.path, field]));
  const answers = new Map(input.fieldSubmissions.map(field => [field.path, field.value]));
  const fieldErrors: Record<string, string> = Object.create(null);
  for (const answer of input.fieldSubmissions) {
    const field = definitions.get(answer.path);
    if (!field) throw new HiringError("invalid_request", 400, "The form has changed. Refresh it before submitting.");
    const v = answer.value;
    const blank = v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (blank && !field.required) continue;
    let valid = true;
    switch (field.type) {
      case "Boolean": valid = typeof v === "boolean"; break;
      case "Number": valid = typeof v === "number" && Number.isFinite(v) && Number.isSafeInteger(v); break;
      case "Score": valid = object(v) && Number.isInteger(v.score) && Number(v.score) >= 1 && Number(v.score) <= 4 && Object.keys(v).every(k => k === "score"); break;
      case "MultiValueSelect": valid = Array.isArray(v) && v.length <= 100 && v.every(item => typeof item === "string" && field.options?.some(o => o.value === item)) && new Set(v).size === v.length; break;
      case "ValueSelect": valid = typeof v === "string" && !!field.options?.some(o => o.value === v); break;
      default:
        valid = typeof v === "string" && v.length <= (field.type === "LongText" ? 20000 : field.type === "File" ? 20000 : 2000) && v.trim().length > 0;
        if (valid && field.type === "Email") valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v as string);
        if (valid && field.type === "Date") {
          const date = new Date(`${v}T00:00:00Z`);
          valid = /^\d{4}-\d{2}-\d{2}$/.test(v as string) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
        }
        if (valid && (field.type === "SocialLink" || field.type === "Url")) {
          try { const url = new URL(v as string); valid = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { valid = false; }
        }
    }
    if (!valid || blank) fieldErrors[field.path] = `Check ${field.title.toLowerCase()}.`;
  }
  for (const field of fields) if (field.required && !answers.has(field.path)) fieldErrors[field.path] = `${field.title} is required.`;
  if (Object.keys(fieldErrors).length) throw new HiringError("invalid_application", 422, "Please check the highlighted answers.", fieldErrors);
}
