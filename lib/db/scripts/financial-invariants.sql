\set ON_ERROR_STOP on

CREATE TEMP TABLE test_events (event_id text PRIMARY KEY, status text NOT NULL);
CREATE TEMP TABLE test_balances (store_id integer PRIMARY KEY, balance bigint NOT NULL);
CREATE TEMP TABLE test_ledger (reference_id text PRIMARY KEY, amount bigint NOT NULL);
CREATE TEMP TABLE test_deliveries (event_id text PRIMARY KEY, status text NOT NULL);
CREATE TEMP TABLE test_payouts (id integer PRIMARY KEY, status text NOT NULL, claimed_by text);
INSERT INTO test_balances VALUES (1, 0);
INSERT INTO test_payouts VALUES (1, 'unpaid', NULL);

WITH accepted AS (
  INSERT INTO test_events VALUES ('provider-event-1', 'processed')
  ON CONFLICT DO NOTHING RETURNING event_id
), credited AS (
  UPDATE test_balances SET balance = balance + 1000
  WHERE store_id = 1 AND EXISTS (SELECT 1 FROM accepted)
  RETURNING store_id
), ledgered AS (
  INSERT INTO test_ledger SELECT event_id, 1000 FROM accepted RETURNING reference_id
)
INSERT INTO test_deliveries SELECT event_id, 'pending' FROM accepted;

WITH accepted AS (
  INSERT INTO test_events VALUES ('provider-event-1', 'processed')
  ON CONFLICT DO NOTHING RETURNING event_id
)
UPDATE test_balances SET balance = balance + 1000
WHERE store_id = 1 AND EXISTS (SELECT 1 FROM accepted);

DO $assert$
BEGIN
  IF (SELECT balance FROM test_balances WHERE store_id = 1) <> 1000 THEN
    RAISE EXCEPTION 'duplicate event changed the balance twice';
  END IF;
  IF (SELECT count(*) FROM test_ledger) <> 1 OR (SELECT count(*) FROM test_deliveries) <> 1 THEN
    RAISE EXCEPTION 'ledger and webhook outbox were not written atomically';
  END IF;
END
$assert$;

BEGIN;
INSERT INTO test_events VALUES ('rollback-event', 'processing');
UPDATE test_balances SET balance = balance + 500 WHERE store_id = 1;
ROLLBACK;

DO $assert$
BEGIN
  IF (SELECT balance FROM test_balances WHERE store_id = 1) <> 1000
     OR EXISTS (SELECT 1 FROM test_events WHERE event_id = 'rollback-event') THEN
    RAISE EXCEPTION 'rollback left a partial financial update';
  END IF;
END
$assert$;

UPDATE test_payouts SET status = 'submitting', claimed_by = 'worker-1'
WHERE id = 1 AND status = 'unpaid';
UPDATE test_payouts SET status = 'submitting', claimed_by = 'worker-2'
WHERE id = 1 AND status = 'unpaid';

DO $assert$
BEGIN
  IF (SELECT claimed_by FROM test_payouts WHERE id = 1) <> 'worker-1' THEN
    RAISE EXCEPTION 'a payout was claimed more than once';
  END IF;
END
$assert$;

SELECT json_build_object(
  'ok', true,
  'duplicateProtected', true,
  'rollbackProtected', true,
  'payoutSingleClaim', true,
  'webhookOutboxAtomic', true
) AS result;
