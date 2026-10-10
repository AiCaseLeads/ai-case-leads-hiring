CREATE TABLE `hub_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hub_audit_created_idx` ON `hub_audit` (`created_at`);
--> statement-breakpoint
INSERT INTO hub_settings (key,value,updated_at) VALUES ('staff_settings_version','1',0) ON CONFLICT(key) DO NOTHING;
