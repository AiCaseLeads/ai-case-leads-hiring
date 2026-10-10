CREATE TABLE staff_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX staff_oauth_expiry ON staff_oauth_states(expires_at);
CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX staff_session_expiry ON staff_sessions(expires_at);
CREATE INDEX staff_session_email ON staff_sessions(email);
