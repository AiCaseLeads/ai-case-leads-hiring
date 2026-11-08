ALTER TABLE hub_applications ADD COLUMN response_entry_json TEXT;
--> statement-breakpoint
CREATE TABLE hub_response_index (
  application_id TEXT PRIMARY KEY NOT NULL REFERENCES hub_applications(id) ON DELETE CASCADE,
  indexed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE hub_response_detector_cache (
  answer_hash TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','ready','unavailable')),
  classification TEXT,
  confidence TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX hub_response_cache_queue ON hub_response_detector_cache(status,run_after,answer_hash);
--> statement-breakpoint
CREATE TABLE hub_response_answers (
  application_id TEXT NOT NULL REFERENCES hub_response_index(application_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  words INTEGER NOT NULL,
  answer_hash TEXT REFERENCES hub_response_detector_cache(answer_hash),
  PRIMARY KEY(application_id,path)
);
--> statement-breakpoint
CREATE INDEX hub_response_answer_hash ON hub_response_answers(answer_hash,application_id);
--> statement-breakpoint
CREATE TABLE hub_response_passages (
  application_id TEXT NOT NULL REFERENCES hub_response_index(application_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  passage_hash TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  PRIMARY KEY(application_id,path,passage_hash)
);
--> statement-breakpoint
CREATE INDEX hub_response_passage_lookup ON hub_response_passages(passage_hash,application_id);
