import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const hubMembers = sqliteTable(
  "hub_members",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("hub_member_email_unique").on(t.email),
    check("hub_member_role", sql`${t.role} IN ('admin','recruiter')`),
  ],
);
export const hubSettings = sqliteTable("hub_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const hubAudit = sqliteTable("hub_audit", {
  id: text("id").primaryKey().notNull(),
  type: text("type").notNull(),
  actor: text("actor").notNull(),
  beforeJson: text("before_json").notNull(),
  afterJson: text("after_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("hub_audit_created_idx").on(t.createdAt)]);
export const hubJobs = sqliteTable(
  "hub_jobs",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    department: text("department").notNull(),
    descriptionHtml: text("description_html").notNull(),
    location: text("location"),
    status: text("status").notNull().default("draft"),
    fieldsJson: text("fields_json").notNull().default("[]"),
    rulesJson: text("rules_json").notNull().default("[]"),
    autoReject: integer("auto_reject").notNull().default(0),
    aiMatchEnabled: integer("ai_match_enabled").notNull().default(0),
    rejectionTemplate: text("rejection_template").notNull(),
    assessmentPrompt: text("assessment_prompt"),
    archiveProject: text("archive_project"),
    archiveCountry: text("archive_country"),
    hiringRound: text("hiring_round"),
    formVersion: integer("form_version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("hub_job_slug_unique").on(t.slug),
    check("hub_job_status", sql`${t.status} IN ('draft','open','closed')`),
  ],
);
export const hubApplications = sqliteTable(
  "hub_applications",
  {
    id: text("id").primaryKey().notNull(),
    submissionKeyHash: text("submission_key_hash").notNull(),
    fingerprint: text("fingerprint").notNull(),
    sessionHash: text("session_hash").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => hubJobs.id),
    jobTitle: text("job_title").notNull(),
    archiveProject: text("archive_project"),
    archiveCountry: text("archive_country"),
    hiringRound: text("hiring_round"),
    formVersion: integer("form_version").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    stage: text("stage").notNull(),
    qualification: text("qualification").notNull(),
    qualificationJson: text("qualification_json").notNull(),
    answersJson: text("answers_json").notNull(),
    responseEntryJson: text("response_entry_json"),
    fieldsJson: text("fields_json").notNull(),
    utmJson: text("utm_json").notNull(),
    source: text("source").notNull(),
    assignee: text("assignee"),
    rejectionReason: text("rejection_reason"),
    driveFolderId: text("drive_folder_id"),
    driveFolderUrl: text("drive_folder_url"),
    revision: integer("revision").notNull().default(1),
    stageEnteredAt: integer("stage_entered_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("hub_submission_key_unique").on(t.submissionKeyHash),
    index("hub_application_stage_idx").on(t.stage, t.jobId, t.createdAt),
    index("hub_application_email_idx").on(t.email),
    index("hub_applications_candidate_read_idx").on(sql`CASE WHEN trim(${t.email})<>'' THEN 'e:'||lower(trim(${t.email})) ELSE 'a:'||${t.id} END`,t.createdAt,t.jobId),
    index("hub_applications_job_created_read_idx").on(t.jobId,t.createdAt,t.id),
    check(
      "hub_qualification_valid",
      sql`${t.qualification} IN ('pass','review','fail')`,
    ),
  ],
);
export const hubFiles = sqliteTable(
  "hub_files",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => hubJobs.id),
    fieldPath: text("field_path").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull(),
    uploadedAt: integer("uploaded_at"),
    applicationId: text("application_id").references(() => hubApplications.id),
    expiresAt: integer("expires_at").notNull(),
    sessionHash: text("session_hash").notNull(),
  },
  (t) => [
    uniqueIndex("hub_file_object_unique").on(t.objectKey),
    index("hub_file_app_idx").on(t.applicationId),
    index("hub_file_expiry_idx").on(t.applicationId,t.expiresAt),
    check("hub_file_size_valid", sql`${t.size} > 0 AND ${t.size} <= 10485760`),
  ],
);
export const hubFileText = sqliteTable("hub_file_text", {
  fileId: text("file_id").primaryKey().notNull().references(() => hubFiles.id, { onDelete: "cascade" }),
  uploadedAt: integer("uploaded_at").notNull(), size: integer("size").notNull(), contentType: text("content_type").notNull(), parserVersion: text("parser_version").notNull(),
  status: text("status").notNull().default("pending"), text: text("text").notNull().default(""),
  truncated: integer("truncated").notNull().default(0), ocrIncomplete: integer("ocr_incomplete").notNull().default(0), pages: integer("pages").notNull().default(0), ocrPages: integer("ocr_pages").notNull().default(0),
  errorCode: text("error_code"), attempts: integer("attempts").notNull().default(0), runAfter: integer("run_after").notNull().default(0),
  leaseToken: text("lease_token"), leaseUntil: integer("lease_until").notNull().default(0), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [index("hub_file_text_work_idx").on(t.status,t.runAfter,t.uploadedAt), check("hub_file_text_status",sql`${t.status} IN ('pending','running','ready','failed','no_text','password_protected','invalid','too_many_pages','too_large')`),check("hub_file_text_attempts",sql`${t.attempts}>=0`),check("hub_file_text_size",sql`length(${t.text})<=200000`)]);
export const hubHistory = sqliteTable(
  "hub_history",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    type: text("type").notNull(),
    text: text("text").notNull(),
    actor: text("actor").notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("hub_history_app_idx").on(t.applicationId, t.createdAt)],
);
export const hubTasks = sqliteTable(
  "hub_tasks",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: integer("run_after").notNull(),
    leaseUntil: integer("lease_until"),
    leaseToken: text("lease_token"),
    lastError: text("last_error"),
    resultJson: text("result_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("hub_task_pending_idx").on(t.status, t.runAfter),
    index("hub_task_application_idx").on(t.applicationId, t.kind, t.status),
    check(
      "hub_task_status_valid",
      sql`${t.status} IN ('pending','running','done','failed','uncertain')`,
    ),
    check(
      "hub_task_kind_valid",
      sql`${t.kind} IN ('gmail','drive','calendar')`,
    ),
  ],
);
export const hubCommunications = sqliteTable(
  "hub_communications",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    taskId: text("task_id")
      .notNull()
      .references(() => hubTasks.id),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("pending"),
    providerId: text("provider_id"),
    threadId: text("thread_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("hub_communication_task_unique").on(t.taskId), index("hub_communication_app_idx").on(t.applicationId,desc(t.createdAt),t.id)],
);
export const hubAssessments = sqliteTable(
  "hub_assessments",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    status: text("status").notNull().default("invited"),
    prompt: text("prompt").notNull(),
    answer: text("answer"),
    submittedAt: integer("submitted_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("hub_assessment_app_idx").on(t.applicationId, t.createdAt)],
);
export const hubInterviews = sqliteTable(
  "hub_interviews",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    status: text("status").notNull().default("invited"),
    start: text("start"),
    end: text("end"),
    timeZone: text("time_zone"),
    meetUrl: text("meet_url"),
    providerId: text("provider_id"),
    attended: integer("attended"),
    calendarId: text("calendar_id"),
    reservationKey: text("reservation_key"),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("hub_interview_app_idx").on(t.applicationId, t.createdAt)],
);
export const hubReservations = sqliteTable(
  "hub_reservations",
  {
    key: text("key").primaryKey().notNull(),
    interviewId: text("interview_id")
      .notNull()
      .references(() => hubInterviews.id),
    calendarId: text("calendar_id").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("hub_interview_reservation_unique").on(t.interviewId),
    index("hub_reservation_interval_idx").on(t.calendarId, t.start, t.end),
  ],
);
export const hubLinks = sqliteTable(
  "hub_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    kind: text("kind").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    payloadJson: text("payload_json").notNull(),
  },
  (t) => [
    index("hub_links_app_idx").on(t.applicationId, t.kind),
    check("hub_link_kind_valid", sql`${t.kind} IN ('assessment','interview')`),
  ],
);
export const hubScorecards = sqliteTable(
  "hub_scorecards",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => hubApplications.id),
    actor: text("actor").notNull(),
    score: integer("score").notNull(),
    criteria: text("criteria").notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("hub_scorecard_reviewer_idx").on(t.applicationId,t.actor,t.createdAt,t.id),
    check(
      "hub_scorecard_score_valid",
      sql`${t.score} >= 1 AND ${t.score} <= 5`,
    ),
  ],
);

export const hubAiCriteria = sqliteTable("hub_ai_criteria", {
 jobId:text("job_id").notNull().references(()=>hubJobs.id),formVersion:integer("form_version").notNull(),
 status:text("status").notNull().default("pending"),criteriaJson:text("criteria_json"),attempts:integer("attempts").notNull().default(0),runAfter:integer("run_after").notNull().default(0),leaseToken:text("lease_token"),leaseUntil:integer("lease_until"),error:text("error"),updatedAt:integer("updated_at").notNull()
},t=>[primaryKey({columns:[t.jobId,t.formVersion]})]);
export const hubAiMatches = sqliteTable("hub_ai_matches", {
 applicationId:text("application_id").notNull().references(()=>hubApplications.id),jobId:text("job_id").notNull().references(()=>hubJobs.id),formVersion:integer("form_version").notNull(),status:text("status").notNull().default("pending"),score:real("score"),reviewJson:text("review_json"),warningsJson:text("warnings_json").notNull().default("[]"),attempts:integer("attempts").notNull().default(0),runAfter:integer("run_after").notNull().default(0),leaseToken:text("lease_token"),leaseUntil:integer("lease_until"),error:text("error"),updatedAt:integer("updated_at").notNull()
},t=>[primaryKey({columns:[t.applicationId,t.formVersion]}),index("hub_ai_matches_queue").on(t.status,t.runAfter,t.updatedAt),index("hub_ai_matches_job").on(t.jobId,t.formVersion,t.score)]);

export const recruitingHelp = sqliteTable("hub_recruiting_help", {
  id: text("id").primaryKey().notNull(), requestId: text("request_id").notNull(),fingerprint: text("fingerprint").notNull(),
  email: text("email").notNull(), job: text("job").notNull(), kind: text("kind").notNull(), message: text("message").notNull(),
  status: text("status").notNull().default("open"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), resolvedBy: text("resolved_by"),
}, table => [index("hub_recruiting_help_queue").on(table.status,table.createdAt),index("hub_recruiting_help_retention").on(table.status,table.updatedAt),check("recruiting_help_status",sql`${table.status} in ('open','resolved')`)]);

export const hubApplicationViews = sqliteTable("hub_application_views", {
  applicationId:text("application_id").notNull().references(()=>hubApplications.id,{onDelete:"cascade"}),
  viewerEmail:text("viewer_email").notNull(),
  viewedAt:integer("viewed_at").notNull(),
}, table => [primaryKey({columns:[table.applicationId,table.viewerEmail]})]);

export const hubRecruiterReviews = sqliteTable("hub_recruiter_reviews", {
 applicationId:text("application_id").primaryKey().notNull().references(()=>hubApplications.id),
 version:integer("version").notNull().default(1),recommendation:text("recommendation").notNull().default(""),notes:text("notes").notNull().default(""),summary:text("summary").notNull().default(""),recordingUrl:text("recording_url").notNull().default(""),salaryExpectation:text("salary_expectation").notNull().default(""),availability:text("availability").notNull().default(""),concerns:text("concerns").notNull().default(""),updatedBy:text("updated_by").notNull(),updatedAt:integer("updated_at").notNull(),
},table=>[index("hub_recruiter_review_updated_idx").on(table.updatedAt)]);

export const hubResponseIndex = sqliteTable("hub_response_index", {
  applicationId: text("application_id").primaryKey().notNull().references(()=>hubApplications.id,{onDelete:"cascade"}),
  indexedAt: integer("indexed_at").notNull(),
});
export const hubResponseDetectorCache = sqliteTable("hub_response_detector_cache", {
  answerHash: text("answer_hash").primaryKey().notNull(), status: text("status").notNull(),
  classification: text("classification"), confidence: text("confidence"), attempts: integer("attempts").notNull().default(0),
  runAfter: integer("run_after").notNull().default(0), leaseToken: text("lease_token"), updatedAt: integer("updated_at").notNull(),
}, t=>[index("hub_response_cache_queue").on(t.status,t.runAfter,t.answerHash),check("hub_response_status",sql`${t.status} IN ('pending','running','ready','unavailable')`)]);
export const hubResponseAnswers = sqliteTable("hub_response_answers", {
  applicationId:text("application_id").notNull().references(()=>hubResponseIndex.applicationId,{onDelete:"cascade"}),
  path:text("path").notNull(), title:text("title").notNull(), words:integer("words").notNull(),
  answerHash:text("answer_hash").references(()=>hubResponseDetectorCache.answerHash),
},t=>[primaryKey({columns:[t.applicationId,t.path]}),index("hub_response_answer_hash").on(t.answerHash,t.applicationId)]);
export const hubResponsePassages = sqliteTable("hub_response_passages", {
  applicationId:text("application_id").notNull().references(()=>hubResponseIndex.applicationId,{onDelete:"cascade"}),
  path:text("path").notNull(), passageHash:text("passage_hash").notNull(), excerpt:text("excerpt").notNull(),
},t=>[primaryKey({columns:[t.applicationId,t.path,t.passageHash]}),index("hub_response_passage_lookup").on(t.passageHash,t.applicationId)]);
