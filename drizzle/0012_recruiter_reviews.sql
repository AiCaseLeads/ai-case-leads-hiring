CREATE TABLE IF NOT EXISTS hub_recruiter_reviews (
  application_id TEXT PRIMARY KEY NOT NULL REFERENCES hub_applications(id),
  version INTEGER NOT NULL DEFAULT 1,
  recommendation TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  recording_url TEXT NOT NULL DEFAULT '',
  salary_expectation TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT '',
  concerns TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_recruiter_review_updated_idx ON hub_recruiter_reviews(updated_at);
