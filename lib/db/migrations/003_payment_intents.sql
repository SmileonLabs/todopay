BEGIN;

CREATE TABLE IF NOT EXISTS payment_intents (
  id serial PRIMARY KEY,
  public_id text NOT NULL,
  merchant_id integer NOT NULL,
  merchant_order_id text NOT NULL,
  external_customer_id text,
  member_id integer,
  virtual_account_id integer,
  transaction_id integer,
  amount numeric(18, 0) NOT NULL,
  currency text NOT NULL DEFAULT 'KRW',
  status text NOT NULL DEFAULT 'requires_member',
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  provider_tracking_number text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  expires_at timestamp NOT NULL,
  succeeded_at timestamp,
  cancelled_at timestamp,
  reversed_at timestamp,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_intents_amount_positive_check CHECK (amount > 0),
  CONSTRAINT payment_intents_currency_check CHECK (currency = 'KRW'),
  CONSTRAINT payment_intents_version_check CHECK (version > 0),
  CONSTRAINT payment_intents_status_check CHECK (status IN (
    'requires_member', 'awaiting_deposit', 'processing', 'succeeded',
    'amount_mismatch', 'expired', 'cancelled', 'reversed'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_public_id_unique ON payment_intents(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_merchant_order_unique ON payment_intents(merchant_id, merchant_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_merchant_idempotency_unique ON payment_intents(merchant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_transaction_unique ON payment_intents(transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_provider_tracking_unique ON payment_intents(provider_tracking_number);
CREATE INDEX IF NOT EXISTS payment_intents_merchant_customer_created_idx ON payment_intents(merchant_id, external_customer_id, created_at);
CREATE INDEX IF NOT EXISTS payment_intents_status_expires_idx ON payment_intents(status, expires_at);

CREATE TABLE IF NOT EXISTS payment_intent_events (
  id serial PRIMARY KEY,
  payment_intent_id integer NOT NULL,
  event_type text NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intent_events_source_unique ON payment_intent_events(source, source_event_id);
CREATE INDEX IF NOT EXISTS payment_intent_events_intent_created_idx ON payment_intent_events(payment_intent_id, created_at);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_intent_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_payment_intent_unique ON transactions(payment_intent_id);

COMMIT;
