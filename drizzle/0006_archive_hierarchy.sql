-- NULL application grouping preserves the original archive layout. New submissions snapshot job grouping.
ALTER TABLE hub_jobs ADD COLUMN archive_project TEXT;
--> statement-breakpoint
ALTER TABLE hub_jobs ADD COLUMN archive_country TEXT;
--> statement-breakpoint
ALTER TABLE hub_jobs ADD COLUMN hiring_round TEXT;
--> statement-breakpoint
ALTER TABLE hub_applications ADD COLUMN archive_project TEXT;
--> statement-breakpoint
ALTER TABLE hub_applications ADD COLUMN archive_country TEXT;
--> statement-breakpoint
ALTER TABLE hub_applications ADD COLUMN hiring_round TEXT;
--> statement-breakpoint
