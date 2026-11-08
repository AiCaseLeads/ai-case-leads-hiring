import type { ApplicationField, FieldSubmission, Job } from "../hiring/types";
export const STAGES = [
  "Application Review",
  "Screening",
  "Assessment",
  "Interview",
  "Awaiting Founder Review",
  "Second Round Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Withdrawn",
] as const;
export type Stage = (typeof STAGES)[number];
export type Rule = {
  fieldPath: string;
  operator: "equals" | "not_equals" | "contains" | "gte" | "lte" | "in" | "not_in";
  value: string | number | boolean | string[];
  reason: string;
  enabled: boolean;
};
export type HubJob = Job & {
  lifecycle?: import("./job-lifecycle").JobLifecycle;
  aiMatchEnabled?: boolean;
  archiveProject?: string;
  archiveCountry?: string;
  hiringRound?: string;
  status: "draft" | "open" | "closed";
  fields: ApplicationField[];
  formVersion: number;
  rules: Rule[];
  autoReject: boolean;
  rejectionTemplate: string;
  assessmentPrompt?: string;
};
export type QualificationEvidence = {
  fieldPath: string;
  reason: string;
  matched: boolean;
  value: unknown;
};
export type ApplicationSummary = {
  interviewProgress?: import("./interview-progress").InterviewProgress;
  viewedAt?: number | null;
  trashed?: boolean;
  id: string;
  revision: number;
  name: string;
  email: string;
  jobId: string;
  jobTitle: string;
  stage: Stage;
  notesReview?: import("./note-review").NotesReview;
  qualification: "pass" | "review" | "fail";
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
  source: string;
  driveFolderUrl?: string;
  duplicateEmail: boolean;
  duplicateApplicationCount: number;
  grade: Grade;
  aiMatch?: import("../ai/matchtypes").AiMatchSummary;
};
export type Grade = {
  reviewed: boolean;
  averageScore: number | null;
  scorePercent: number | null;
  reviewerCount: number;
  scorecardCount: number;
  latestReviews: { actor: string; score: number; criteria: string; text: string; createdAt: number }[];
};
export type HistoryEntry = {
  id: string;
  type: string;
  text: string;
  actor: string;
  createdAt: number;
};
export type Communication = {
  cc?: string[];
  id: string;
  purpose?: string;
  subject: string;
  body: string;
  status: string;
  createdAt: number;
};
export type Assessment = {
  id: string;
  status: "invited" | "submitted";
  prompt: string;
  answer?: string;
  submittedAt?: number;
  linkExpiresAt?: number;
  linkActive?: boolean;
};
export type Interview = {
  interviewProgress?: import("./interview-progress").InterviewProgress;
  id: string;
  revision: number;
  calendarId?: string;
  attended?: boolean;
  status:
    | "invited"
    | "pending"
    | "booked"
    | "cancel_pending"
    | "cancelled"
    | "failed";
  start?: string;
  end?: string;
  timeZone?: string;
  meetUrl?: string;
  bookingUrl?: string;
  linkExpiresAt?: number;
  linkActive?: boolean;
  hasSentBookingLink?: boolean;
};
export type ApplicationDetail = ApplicationSummary & {
  archiveProject?: string;
  archiveCountry?: string;
  hiringRound?: string;
  revision: number;
  formVersion: number;
  utmData: Record<string,string|null>;
  answers: FieldSubmission[];
  fields: ApplicationField[];
  files: {
    id: string;
    fieldPath?: string;
    filename: string;
    contentType: string;
    size: number;
    url: string;
  }[];
  history: HistoryEntry[];
  notes: HistoryEntry[];
  communications: Communication[];
  assessment?: Assessment;
  interview?: Interview;
  assessments: Assessment[];
  interviews: Interview[];
  scorecards: {
    id: string;
    actor: string;
    score: number;
    criteria: string;
    text: string;
    createdAt: number;
  }[];
  qualificationEvidence: QualificationEvidence[];
};
export type Member = {
  id: string;
  email: string;
  role: "admin" | "recruiter";
  active: boolean;
};
export type Task = {
  id: string;
  applicationId: string;
  kind: "gmail" | "drive" | "calendar";
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "uncertain";
  attempts: number;
  runAfter: number;
  leaseUntil: number | null;
  leaseToken: string | null;
  lastError: string | null;
  result?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};
export type IntegrationStatus = {
  google: boolean;
  drive: boolean;
  applicationsEnabled: boolean;
};
export type Scheduling = {
  remindersEnabled: boolean;
  timeZone: string;
  startHour: number;
  endHour: number;
  durationMinutes: number;
  weekdays: number[];
  configured: boolean;
};
export type CandidateHooks = {
  personalBusy?: (snapshot: import("../personal-calendar/service").InterviewCalendar, input: {start:string;end:string;calendarIds?:string[]}) => Promise<{start:string;end:string}[]>;
  busy?: (input: {
    start: string;
    end: string;
    calendarIds?: string[];
  }) => Promise<{ start: string; end: string }[]>;
};
