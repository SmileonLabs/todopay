BEGIN;

CREATE TABLE IF NOT EXISTS fee_policy_versions (
  id serial PRIMARY KEY,
  store_id integer NOT NULL,
  version integer NOT NULL,
  total_rate numeric(5, 2) NOT NULL,
  deposit_fee integer NOT NULL DEFAULT 0,
  withdrawal_fee integer NOT NULL DEFAULT 0,
  configuration_hash text NOT NULL,
  allocation_snapshot jsonb NOT NULL,
  created_by integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fee_policy_versions_total_rate_check
    CHECK (total_rate >= 0 AND total_rate <= 100),
  CONSTRAINT fee_policy_versions_deposit_fee_check CHECK (deposit_fee >= 0),
  CONSTRAINT fee_policy_versions_withdrawal_fee_check CHECK (withdrawal_fee >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS fee_policy_versions_store_version_unique
  ON fee_policy_versions(store_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS fee_policy_versions_store_hash_unique
  ON fee_policy_versions(store_id, configuration_hash);
CREATE INDEX IF NOT EXISTS fee_policy_versions_store_created_idx
  ON fee_policy_versions(store_id, created_at);

CREATE TABLE IF NOT EXISTS internal_fee_settlements (
  id serial PRIMARY KEY,
  source_event_id text NOT NULL,
  source_event_type text NOT NULL,
  external_transaction_id text NOT NULL,
  tracking_number text NOT NULL,
  store_id integer NOT NULL,
  policy_version_id integer NOT NULL,
  gross_amount numeric(18, 0) NOT NULL,
  todopay_fee numeric(18, 0) NOT NULL,
  settlement_amount numeric(18, 0) NOT NULL,
  internal_fee_amount numeric(18, 0) NOT NULL,
  store_commission_amount numeric(18, 0) NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  reversed_by_event_id text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  reversed_at timestamp,
  CONSTRAINT internal_fee_settlements_amounts_check CHECK (
    gross_amount >= 0
    AND todopay_fee >= 0
    AND settlement_amount >= 0
    AND internal_fee_amount >= 0
    AND store_commission_amount >= 0
  ),
  CONSTRAINT internal_fee_settlements_status_check
    CHECK (status IN ('applied', 'reversed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS internal_fee_settlements_source_event_unique
  ON internal_fee_settlements(source_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS internal_fee_settlements_reversal_event_unique
  ON internal_fee_settlements(reversed_by_event_id);
CREATE INDEX IF NOT EXISTS internal_fee_settlements_store_created_idx
  ON internal_fee_settlements(store_id, created_at);
CREATE INDEX IF NOT EXISTS internal_fee_settlements_external_tx_idx
  ON internal_fee_settlements(external_transaction_id);
CREATE INDEX IF NOT EXISTS internal_fee_settlements_tracking_idx
  ON internal_fee_settlements(tracking_number);

CREATE TABLE IF NOT EXISTS internal_fee_ledger_entries (
  id serial PRIMARY KEY,
  settlement_id integer NOT NULL,
  source_event_id text NOT NULL,
  idempotency_key text NOT NULL,
  beneficiary_user_id integer NOT NULL,
  store_id integer NOT NULL,
  entry_type text NOT NULL,
  component text NOT NULL,
  rate numeric(5, 2) NOT NULL,
  amount numeric(18, 0) NOT NULL,
  commission_amount numeric(18, 0) NOT NULL,
  reference_entry_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT internal_fee_ledger_entry_type_check
    CHECK (entry_type IN ('allocation', 'reversal')),
  CONSTRAINT internal_fee_ledger_component_check
    CHECK (component IN ('store_settlement', 'organization_commission')),
  CONSTRAINT internal_fee_ledger_rate_check CHECK (rate >= 0 AND rate <= 100),
  CONSTRAINT internal_fee_ledger_commission_check CHECK (
    (entry_type = 'allocation' AND amount >= 0 AND commission_amount >= 0)
    OR (entry_type = 'reversal' AND amount <= 0 AND commission_amount <= 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS internal_fee_ledger_idempotency_unique
  ON internal_fee_ledger_entries(idempotency_key);
CREATE INDEX IF NOT EXISTS internal_fee_ledger_settlement_idx
  ON internal_fee_ledger_entries(settlement_id, id);
CREATE INDEX IF NOT EXISTS internal_fee_ledger_beneficiary_created_idx
  ON internal_fee_ledger_entries(beneficiary_user_id, created_at);

CREATE TABLE IF NOT EXISTS internal_fee_balances (
  user_id integer NOT NULL,
  store_id integer NOT NULL,
  available_amount numeric(18, 0) NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT internal_fee_balances_user_store_pk PRIMARY KEY (user_id, store_id)
);
CREATE INDEX IF NOT EXISTS internal_fee_balances_store_idx
  ON internal_fee_balances(store_id, user_id);

COMMIT;
