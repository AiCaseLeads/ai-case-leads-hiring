CREATE TABLE hub_collections (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('view','list')),
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('personal','team')),
  query TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  last_mutation TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX hub_collections_owner_visibility ON hub_collections(owner,visibility);
--> statement-breakpoint
CREATE TABLE hub_collection_members (
  collection_id TEXT NOT NULL REFERENCES hub_collections(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES hub_applications(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(collection_id,application_id)
);
--> statement-breakpoint
CREATE INDEX hub_collection_member_application ON hub_collection_members(application_id,collection_id);
--> statement-breakpoint
CREATE TABLE hub_collection_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  collection_id TEXT NOT NULL REFERENCES hub_collections(id) ON DELETE CASCADE,
  requester TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  prompt TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX hub_collection_reviews_reviewer ON hub_collection_reviews(reviewer,created_at);
--> statement-breakpoint
CREATE INDEX hub_collection_reviews_requester ON hub_collection_reviews(requester,created_at);
--> statement-breakpoint
CREATE TABLE hub_collection_review_items (
  review_id TEXT NOT NULL REFERENCES hub_collection_reviews(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES hub_applications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER,
  PRIMARY KEY(review_id,application_id)
);
