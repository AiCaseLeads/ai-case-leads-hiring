CREATE TABLE `hub_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_key_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	`session_hash` text NOT NULL,
	`job_id` text NOT NULL,
	`job_title` text NOT NULL,
	`form_version` integer NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`stage` text NOT NULL,
	`qualification` text NOT NULL,
	`qualification_json` text NOT NULL,
	`answers_json` text NOT NULL,
	`fields_json` text NOT NULL,
	`utm_json` text NOT NULL,
	`source` text NOT NULL,
	`assignee` text,
	`rejection_reason` text,
	`drive_folder_id` text,
	`drive_folder_url` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`stage_entered_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `hub_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hub_qualification_valid" CHECK("hub_applications"."qualification" IN ('pass','review','fail'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_submission_key_unique` ON `hub_applications` (`submission_key_hash`);--> statement-breakpoint
CREATE INDEX `hub_application_stage_idx` ON `hub_applications` (`stage`,`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hub_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`prompt` text NOT NULL,
	`answer` text,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hub_assessment_app_idx` ON `hub_assessments` (`application_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hub_communications` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`task_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_id` text,
	`thread_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `hub_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_communication_task_unique` ON `hub_communications` (`task_id`);--> statement-breakpoint
CREATE TABLE `hub_files` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`field_path` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`uploaded_at` integer,
	`application_id` text,
	`expires_at` integer NOT NULL,
	`session_hash` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `hub_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hub_file_size_valid" CHECK("hub_files"."size" > 0 AND "hub_files"."size" <= 10485760)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_file_object_unique` ON `hub_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `hub_file_app_idx` ON `hub_files` (`application_id`);--> statement-breakpoint
CREATE TABLE `hub_history` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`actor` text NOT NULL,
	`from_stage` text,
	`to_stage` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hub_history_app_idx` ON `hub_history` (`application_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hub_interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`start` text,
	`end` text,
	`time_zone` text,
	`meet_url` text,
	`provider_id` text,
	`attended` integer,
	`calendar_id` text,
	`reservation_key` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hub_interview_app_idx` ON `hub_interviews` (`application_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hub_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`department` text NOT NULL,
	`description_html` text NOT NULL,
	`location` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`fields_json` text DEFAULT '[]' NOT NULL,
	`rules_json` text DEFAULT '[]' NOT NULL,
	`auto_reject` integer DEFAULT 0 NOT NULL,
	`rejection_template` text NOT NULL,
	`assessment_prompt` text,
	`form_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "hub_job_status" CHECK("hub_jobs"."status" IN ('draft','open','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_job_slug_unique` ON `hub_jobs` (`slug`);--> statement-breakpoint
CREATE TABLE `hub_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hub_link_kind_valid" CHECK("hub_links"."kind" IN ('assessment','interview'))
);
--> statement-breakpoint
CREATE INDEX `hub_links_app_idx` ON `hub_links` (`application_id`,`kind`);--> statement-breakpoint
CREATE TABLE `hub_members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "hub_member_role" CHECK("hub_members"."role" IN ('admin','recruiter'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_member_email_unique` ON `hub_members` (`email`);--> statement-breakpoint
CREATE TABLE `hub_reservations` (
	`key` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `hub_interviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_interview_reservation_unique` ON `hub_reservations` (`interview_id`);--> statement-breakpoint
CREATE INDEX `hub_reservation_interval_idx` ON `hub_reservations` (`calendar_id`,`start`,`end`);--> statement-breakpoint
CREATE TABLE `hub_scorecards` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`actor` text NOT NULL,
	`score` integer NOT NULL,
	`criteria` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hub_scorecard_score_valid" CHECK("hub_scorecards"."score" >= 1 AND "hub_scorecards"."score" <= 5)
);
--> statement-breakpoint
CREATE TABLE `hub_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hub_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`lease_until` integer,
	`lease_token` text,
	`last_error` text,
	`result_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `hub_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hub_task_status_valid" CHECK("hub_tasks"."status" IN ('pending','running','done','failed','uncertain')),
	CONSTRAINT "hub_task_kind_valid" CHECK("hub_tasks"."kind" IN ('gmail','drive','calendar'))
);
--> statement-breakpoint
CREATE INDEX `hub_task_pending_idx` ON `hub_tasks` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `hub_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `hub_oauth_expiry_idx` ON `hub_oauth_states` (`expires_at`);