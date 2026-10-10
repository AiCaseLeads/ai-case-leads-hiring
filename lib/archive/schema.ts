import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const archiveEvents = sqliteTable("archive_events", {
  id: text("id").primaryKey(),
  applicationId: text("application_id"),
  action: text("action").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseUntil: integer("lease_until"),
  nextAttemptAt: integer("next_attempt_at"),
  folderId: text("folder_id"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("archive_events_status_idx").on(table.status, table.leaseUntil)]);

export const archiveItems = sqliteTable("archive_items", {
  key: text("key").primaryKey(),
  driveId: text("drive_id").notNull(),
  parentId: text("parent_id").notNull(),
  contentHash: text("content_hash"),
  sessionUrl: text("session_url"),
  updatedAt: integer("updated_at").notNull(),
});

export const archiveCheckpoints = sqliteTable("archive_checkpoints", {
  stream: text("stream").primaryKey(),
  cursor: text("cursor"),
  syncToken: text("sync_token"),
  revision: integer("revision").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
});
