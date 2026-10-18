CREATE TABLE IF NOT EXISTS hub_application_views (
  application_id TEXT NOT NULL REFERENCES hub_applications(id) ON DELETE CASCADE,
  viewer_email TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (application_id, viewer_email)
);
