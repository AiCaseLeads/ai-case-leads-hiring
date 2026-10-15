ALTER TABLE hub_jobs ADD COLUMN ai_match_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE hub_ai_criteria (job_id TEXT NOT NULL REFERENCES hub_jobs(id), form_version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', criteria_json TEXT, attempts INTEGER NOT NULL DEFAULT 0, run_after INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER, error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(job_id,form_version));
--> statement-breakpoint
CREATE TABLE hub_ai_matches (application_id TEXT NOT NULL REFERENCES hub_applications(id), job_id TEXT NOT NULL REFERENCES hub_jobs(id), form_version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', score REAL, review_json TEXT, warnings_json TEXT NOT NULL DEFAULT '[]', attempts INTEGER NOT NULL DEFAULT 0, run_after INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER, error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(application_id,form_version));
--> statement-breakpoint
CREATE INDEX hub_ai_matches_queue ON hub_ai_matches(status,run_after,updated_at);
--> statement-breakpoint
CREATE INDEX hub_ai_matches_job ON hub_ai_matches(job_id,form_version,score);
