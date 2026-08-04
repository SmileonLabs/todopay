UPDATE audit_logs
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

ALTER TABLE audit_logs
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL;
