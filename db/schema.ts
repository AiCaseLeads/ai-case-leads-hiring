import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const hiringSubmissions = sqliteTable(
  "hiring_submissions",
  {
    keyHash: text("key_hash").primaryKey(),
    sessionHash: text("session_hash").notNull(),
    fingerprint: text("fingerprint").notNull(),
    jobPostingId: text("job_posting_id").notNull(),
    jobTitle: text("job_title").notNull(),
    status: text("status").notNull(),
    receiptHash: text("receipt_hash"),
    submittedFormInstanceId: text("submitted_form_instance_id"),
    applicationId: text("application_id"),
    resolutionOperatorId: text("resolution_operator_id"),
    resolutionEvidenceId: text("resolution_evidence_id"),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "hiring_status_valid",
      sql`${table.status} IN ('pending','accepted','blocked','failed')`,
    ),
    uniqueIndex("hiring_form_unique").on(table.submittedFormInstanceId),
    uniqueIndex("hiring_receipt_unique").on(table.receiptHash),
    index("hiring_pending_idx").on(table.status, table.updatedAt),
  ],
);
export const hiringReceipts = sqliteTable("hiring_receipts", {
  receiptHash: text("receipt_hash").primaryKey(),
  submissionKeyHash: text("submission_key_hash")
    .notNull()
    .references(() => hiringSubmissions.keyHash),
  createdAt: integer("created_at").notNull(),
});
export const hiringUploads = sqliteTable(
  "hiring_uploads",
  {
    handleHash: text("handle_hash").primaryKey(),
    sessionHash: text("session_hash").notNull(),
    jobPostingId: text("job_posting_id").notNull(),
    fieldPath: text("field_path").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    contentLength: integer("content_length").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    check(
      "hiring_upload_size_valid",
      sql`${table.contentLength} > 0 AND ${table.contentLength} <= 10485760`,
    ),
    index("hiring_upload_expiry_idx").on(table.expiresAt),
  ],
);
export const hiringRateLimits = sqliteTable(
  "hiring_rate_limits",
  {
    keyHash: text("key_hash").notNull(),
    window: integer("window").notNull(),
    attempts: integer("attempts").notNull(),
  },
  (table) => [primaryKey({ columns: [table.keyHash, table.window] })],
);

export * from "../lib/archive/schema";
export * from "../lib/hub/schema";
export * from "./google-schema";

// Staff identity is separate from applicant sessions and recruiting Workspace grants.
export const staffOAuthStates = sqliteTable("staff_oauth_states", {
  stateHash: text("state_hash").primaryKey().notNull(),
  browserHash: text("browser_hash").notNull(),
  verifier: text("verifier").notNull(),
  nonceHash: text("nonce_hash").notNull(),
  returnTo: text("return_to").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
}, table => [index("staff_oauth_expiry").on(table.expiresAt)]);
export const staffSessions = sqliteTable("staff_sessions", {
  tokenHash: text("token_hash").primaryKey().notNull(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("staff_session_expiry").on(table.expiresAt), index("staff_session_email").on(table.email)]);
