BEGIN;

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamp NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS locked_at timestamp,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS received_at timestamp NOT NULL DEFAULT NOW();

ALTER TABLE payment_events ALTER COLUMN processed_at DROP NOT NULL;
UPDATE payment_events SET status = 'processed' WHERE processed_at IS NOT NULL AND status = 'received';
CREATE INDEX IF NOT EXISTS payment_events_work_idx
  ON payment_events(status, next_attempt_at);

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS submission_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submission_claimed_at timestamp,
  ADD COLUMN IF NOT EXISTS submission_claimed_by text,
  ADD COLUMN IF NOT EXISTS next_submission_at timestamp NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS submission_last_error text;

ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_payment_status_check;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_payment_status_check
  CHECK (withdrawal_status IN ('unpaid', 'submitting', 'processing', 'paid', 'failed', 'unknown'));
CREATE INDEX IF NOT EXISTS withdrawals_submission_work_idx
  ON withdrawals(approval_status, withdrawal_status, next_submission_at);

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

ALTER TABLE otp_settings
  ADD COLUMN IF NOT EXISTS verified_at timestamp,
  ADD COLUMN IF NOT EXISTS last_used_step integer;

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id serial PRIMARY KEY,
  status text NOT NULL,
  balance_mismatch_count integer NOT NULL DEFAULT 0,
  ledger_mismatch_count integer NOT NULL DEFAULT 0,
  stale_event_count integer NOT NULL DEFAULT 0,
  stale_payout_count integer NOT NULL DEFAULT 0,
  dead_event_count integer NOT NULL DEFAULT 0,
  provider_balance text,
  details jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reconciliation_runs_created_at_idx
  ON reconciliation_runs(created_at);
CREATE INDEX IF NOT EXISTS reconciliation_runs_status_created_at_idx
  ON reconciliation_runs(status, created_at);

COMMIT;
