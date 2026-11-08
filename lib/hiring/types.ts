import type { ResponseEntry } from "./response-entry";
export type FieldType = "String" | "Email" | "File" | "Date" | "Number" | "Boolean" | "LongText" | "ValueSelect" | "MultiValueSelect" | "Phone" | "SocialLink" | "Score" | "Url";
export type ApplicationField = {
  path: string;
  title: string;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  description?: string;
  minWords?: number;
  numberFormat?: "number" | "currency";
  currency?: "USD";
};
export type Job = { eligibleCountries?: string[] | "worldwide"; id: string; slug: string; title: string; department: string; descriptionHtml: string; location?: string };
export type JobDefinition = { job: Job; fields: ApplicationField[]; formUnavailable?: string; formVersion?: number };
export type FieldSubmission = { path: string; value: unknown };
export type ApplicationInput = {
  jobPostingId: string;
  fieldSubmissions: FieldSubmission[];
  submissionKey: string;
  formVersion?: number;
  utmData?: Record<string, string | null>;
  responseEntry?: ResponseEntry;
};
export type UploadInput = { jobPostingId: string; fieldPath: string; filename: string; contentType: string; contentLength: number };
export type UploadHandle = { url: string; fields: Record<string, string>; handle: string };
export type SubmissionOutcome = { blocked: boolean; submittedFormInstanceId?: string };
export interface HiringProvider {
  listJobs(): Promise<Job[]>;
  jobInfo(jobPostingId: string): Promise<JobDefinition>;
  createUpload(input: UploadInput): Promise<UploadHandle>;
  submit(input: ApplicationInput): Promise<SubmissionOutcome>;
  resolveApplicationId(submittedFormInstanceId: string): Promise<string>;
}
export type SubmissionStatus = "pending" | "accepted" | "blocked" | "failed";
export type SubmissionRecord = {
  keyHash: string; sessionHash: string; fingerprint: string; jobPostingId: string; jobTitle: string;
  status: SubmissionStatus; receiptHash: string | null; submittedFormInstanceId: string | null;
  applicationId: string | null; createdAt: number; updatedAt: number;
};
export interface HiringStore {
  claim(record: SubmissionRecord): Promise<boolean>;
  find(keyHash: string): Promise<SubmissionRecord | null>;
  finish(keyHash: string, update: Partial<SubmissionRecord>, errorCode?: string): Promise<void>;
  receipt(receiptHash: string): Promise<SubmissionRecord | null>;
  addReceipt(keyHash: string, receiptHash: string): Promise<void>;
  rememberUpload(handleHash: string, sessionHash: string, input: UploadInput, expiresAt: number): Promise<void>;
  ownsUpload(handleHash: string, sessionHash: string, jobPostingId: string, fieldPath: string, now: number): Promise<boolean>;
  takeRateLimit(keyHash: string, window: number, limit: number, intentHash?: string): Promise<boolean>;
}
