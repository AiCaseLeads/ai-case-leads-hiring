CREATE TABLE hub_file_text (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES hub_files(id) ON DELETE CASCADE,
  uploaded_at INTEGER NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  text TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL DEFAULT 0,
  ocr_incomplete INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  ocr_pages INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(status IN ('pending','running','ready','failed','no_text','password_protected','invalid','too_many_pages','too_large')),
  CHECK(attempts >= 0),
  CHECK(length(text) <= 200000)
);
CREATE INDEX hub_file_text_work_idx ON hub_file_text(status,run_after,uploaded_at);
-- Cache-only candidate exports use this exact normalized-email/fallback key.
CREATE INDEX hub_applications_candidate_read_idx ON hub_applications (
  (CASE WHEN trim(email)<>'' THEN 'e:'||lower(trim(email)) ELSE 'a:'||id END),created_at,job_id
);
CREATE INDEX hub_applications_job_created_read_idx ON hub_applications(job_id,created_at,id);
