CREATE TABLE IF NOT EXISTS integration_mappings (
  id serial PRIMARY KEY,
  local_entity_type text NOT NULL,
  local_entity_id integer NOT NULL,
  todopay_entity_type text NOT NULL,
  todopay_entity_id text NOT NULL,
  sync_status text NOT NULL DEFAULT 'active',
  last_verified_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_mappings_local_unique
  ON integration_mappings(local_entity_type, local_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS integration_mappings_todopay_unique
  ON integration_mappings(todopay_entity_type, todopay_entity_id);
CREATE INDEX IF NOT EXISTS integration_mappings_status_idx
  ON integration_mappings(sync_status, updated_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  actor_id integer,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  ip_address text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;
CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
  ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_resource_created_idx
  ON audit_logs(resource_type, resource_id, created_at);

CREATE TABLE IF NOT EXISTS todopay_webhook_events (
  id serial PRIMARY KEY,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature_version text NOT NULL DEFAULT 'v1',
  received_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS todopay_webhook_events_event_unique
  ON todopay_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS todopay_webhook_events_type_received_idx
  ON todopay_webhook_events(event_type, received_at);
