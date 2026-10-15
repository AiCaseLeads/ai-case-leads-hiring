CREATE TABLE IF NOT EXISTS hub_recruiting_help (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  email TEXT NOT NULL,
  job TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_by TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hub_recruiting_help_queue ON hub_recruiting_help(status, created_at DESC);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hub_recruiting_help_retention ON hub_recruiting_help(status, updated_at);
