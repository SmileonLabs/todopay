CREATE TABLE IF NOT EXISTS member_registration_sessions (
  id serial PRIMARY KEY,
  public_id text NOT NULL,
  local_member_id integer NOT NULL,
  todopay_member_id text,
  todopay_registration_id text,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'starting',
  verification_attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  expires_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_registration_sessions_public_unique
  ON member_registration_sessions(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_registration_sessions_local_member_unique
  ON member_registration_sessions(local_member_id);
CREATE INDEX IF NOT EXISTS member_registration_sessions_status_expiry_idx
  ON member_registration_sessions(status, expires_at);
