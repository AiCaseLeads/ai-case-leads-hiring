CREATE TABLE `hiring_rate_limits` (
	`key_hash` text NOT NULL,
	`window` integer NOT NULL,
	`attempts` integer NOT NULL,
	PRIMARY KEY(`key_hash`, `window`)
);
--> statement-breakpoint
CREATE TABLE `hiring_receipts` (
	`receipt_hash` text PRIMARY KEY NOT NULL,
	`submission_key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_key_hash`) REFERENCES `hiring_submissions`(`key_hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hiring_submissions` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	`job_posting_id` text NOT NULL,
	`job_title` text NOT NULL,
	`status` text NOT NULL,
	`receipt_hash` text,
	`submitted_form_instance_id` text,
	`application_id` text,
	`resolution_operator_id` text,
	`resolution_evidence_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "hiring_status_valid" CHECK("hiring_submissions"."status" IN ('pending','accepted','blocked','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hiring_form_unique` ON `hiring_submissions` (`submitted_form_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hiring_receipt_unique` ON `hiring_submissions` (`receipt_hash`);--> statement-breakpoint
CREATE INDEX `hiring_pending_idx` ON `hiring_submissions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `hiring_uploads` (
	`handle_hash` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`job_posting_id` text NOT NULL,
	`field_path` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`content_length` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "hiring_upload_size_valid" CHECK("hiring_uploads"."content_length" > 0 AND "hiring_uploads"."content_length" <= 10485760)
);
--> statement-breakpoint
CREATE INDEX `hiring_upload_expiry_idx` ON `hiring_uploads` (`expires_at`);--> statement-breakpoint
CREATE TABLE `archive_checkpoints` (
	`stream` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`sync_token` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `archive_events` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`action` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`next_attempt_at` integer,
	`folder_id` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `archive_events_status_idx` ON `archive_events` (`status`,`lease_until`);--> statement-breakpoint
CREATE TABLE `archive_items` (
	`key` text PRIMARY KEY NOT NULL,
	`drive_id` text NOT NULL,
	`parent_id` text NOT NULL,
	`content_hash` text,
	`session_url` text,
	`updated_at` integer NOT NULL
);
