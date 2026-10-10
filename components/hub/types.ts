import type {
  ApplicationField,
  FieldSubmission,
  Job,
} from "@/lib/hiring/types";

export type Member = {
  id?: string;
  active?: boolean;
  email: string;
  userId?: string;
  role: "admin" | "recruiter";
};
export const stages = [
  "Application Review",
  "Screening",
  "Assessment",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Withdrawn",
];
export type Rule = {
  fieldPath: string;
  operator: "equals" | "not_equals" | "contains" | "gte" | "lte";
  value: string | number | boolean;
  reason: string;
  enabled: boolean;
};
export type HubJob = Job & {
  status: "draft" | "open" | "closed";
  fields: ApplicationField[];
  formVersion: number;
  rules: Rule[];
  autoReject: boolean;
  rejectionTemplate: string;
  assessmentPrompt?: string;
};
export type ApplicationSummary = {
  id: string;
  revision: number;
  name: string;
  email: string;
  jobId: string;
  jobTitle: string;
  stage: string;
  qualification: "pass" | "review" | "fail";
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
  source: string;
  driveFolderUrl?: string;
  duplicateEmail?: boolean;
  duplicateApplicationCount?: number;
  grade?: ReviewerGrade;
};
export type ReviewerGrade = {
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
export type Assessment = {
  id: string;
  status: string;
  prompt: string;
  answer?: string;
  submittedAt?: number;
  linkExpiresAt?: number;
  linkActive?: boolean;
};
export type Interview = {
  id: string;
  status: string;
  start?: number | string;
  end?: number | string;
  timeZone?: string;
  meetUrl?: string;
  bookingUrl?: string;
  attended?: boolean;
  linkExpiresAt?: number;
  linkActive?: boolean;
};
export type ApplicationDetail = ApplicationSummary & {
  answers: FieldSubmission[];
  fields: ApplicationField[];
  files: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    url: string;
  }[];
  history: HistoryEntry[];
  notes: HistoryEntry[];
  communications: {
    id: string;
    subject: string;
    body: string;
    status: string;
    createdAt: number;
  }[];
  assessment?: Assessment;
  interview?: Interview;
  assessments?: Assessment[];
  interviews?: Interview[];
  scorecards: {
    id: string;
    actor: string;
    score: number;
    criteria: string;
    text: string;
    createdAt: number;
  }[];
  qualificationEvidence: {
    fieldPath: string;
    reason: string;
    matched: boolean;
    value: unknown;
  }[];
};
export type Overview = {
  counts: {
    applications: number;
    active: number;
    rejected: number;
    hired: number;
  };
  stageCounts: { stage: string; count: number }[];
  recentApplications: ApplicationSummary[];
  integrations: {
    google: boolean;
    drive: boolean;
    applicationsEnabled: boolean;
  };
  jobs: HubJob[];
};
export type ApplicationList = {
  items: ApplicationSummary[];
  total: number;
  page: number;
};
export type Report = {
  applications: number;
  qualificationRate: number;
  stageCounts: { stage: string; count: number }[];
  sources: {
    source: string;
    count: number;
    qualified?: number;
    interviewed?: number;
    hired?: number;
    qualificationRate?: number;
    interviewRate?: number;
    hireRate?: number;
  }[];
  timeInStage: { stage: string; averageHours: number }[];
  workload: { assignee: string; count: number }[];
  attendance: { attended: number; total: number };
  conversion: { stage: string; count: number }[];
};
export type Settings = {
  settingsVersion: number;
  members: Member[];
  google: {
    connected: boolean;
    sender: string;
    expectedSender?: string;
    calendarId: string;
    driveRootId: string;
  };
  queue: { pending: number; failed: number };
  templates: { rejection: string };
  applicationsEnabled: boolean;
  mailSync?: { lastCheckedAt?: number | null; lastError?: string | null };
  scheduling?: {
    timeZone: string;
    startHour: number;
    endHour: number;
    durationMinutes: number;
    weekdays: number[];
    configured: boolean;
    remindersEnabled?: boolean;
  };
  accessAudit?: { id: string; type: string; actor: string; before: Record<string, unknown>; after: Record<string, unknown>; createdAt: number }[];
  workerHealth?: { lastCheckedAt?: number; lastCompletedAt?: number; failed?: number; pending?: number; error?: string } | null;
};
export type Task = {
  id: string;
  applicationId?: string;
  kind: string;
  status: string;
  attempts: number;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
  runAfter?: number;
};
export type CandidateView = {
  kind: "assessment" | "interview";
  jobTitle: string;
  status?: string;
  prompt?: string;
  assessment?: Assessment;
  interview?: Interview;
  slots?: (string | { start: string; end?: string })[];
  availabilityError?: string;
};
