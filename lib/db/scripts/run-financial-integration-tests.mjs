import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const suffix = crypto.randomBytes(6).toString("hex");
const events = `financial_test_events_${suffix}`;
const balances = `financial_test_balances_${suffix}`;
const ledger = `financial_test_ledger_${suffix}`;
const payouts = `financial_test_payouts_${suffix}`;
const deliveries = `financial_test_deliveries_${suffix}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await pool.query(`
    CREATE UNLOGGED TABLE ${events} (
      event_id text PRIMARY KEY,
      status text NOT NULL,
      payload jsonb NOT NULL
    );
    CREATE UNLOGGED TABLE ${balances} (
      store_id integer PRIMARY KEY,
      balance bigint NOT NULL DEFAULT 0
    );
    CREATE UNLOGGED TABLE ${ledger} (
      reference_id text PRIMARY KEY,
      amount bigint NOT NULL
    );
    CREATE UNLOGGED TABLE ${deliveries} (
      event_id text PRIMARY KEY,
      status text NOT NULL
    );
    CREATE UNLOGGED TABLE ${payouts} (
      id integer PRIMARY KEY,
      status text NOT NULL,
      claimed_by text
    );
    INSERT INTO ${balances}(store_id, balance) VALUES (1, 0);
    INSERT INTO ${payouts}(id, status) VALUES (1, 'unpaid');
  `);

  const duplicateAttempts = await Promise.all(
    Array.from({ length: 50 }, async (_, index) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query(
          `INSERT INTO ${events}(event_id, status, payload)
           VALUES ('provider-event-1', 'processed', '{}')
           ON CONFLICT DO NOTHING RETURNING event_id`,
        );
        if (inserted.rowCount === 1) {
          await client.query(`UPDATE ${balances} SET balance = balance + 1000 WHERE store_id = 1`);
          await client.query(`INSERT INTO ${ledger}(reference_id, amount) VALUES ('provider-event-1', 1000)`);
          await client.query(`INSERT INTO ${deliveries}(event_id, status) VALUES ('provider-event-1', 'pending')`);
        }
        await client.query("COMMIT");
        return inserted.rowCount;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );
  const state = await pool.query(`
    SELECT
      (SELECT balance FROM ${balances} WHERE store_id = 1) balance,
      (SELECT COUNT(*) FROM ${events}) event_count,
      (SELECT COUNT(*) FROM ${ledger}) ledger_count,
      (SELECT COUNT(*) FROM ${deliveries}) delivery_count
  `);
  assert(duplicateAttempts.reduce((sum, value) => sum + value, 0) === 1, "exactly one duplicate attempt must win");
  assert(Number(state.rows[0].balance) === 1000, "duplicate event credited balance more than once");
  assert(Number(state.rows[0].event_count) === 1, "duplicate inbox row was created");
  assert(Number(state.rows[0].ledger_count) === 1, "duplicate ledger row was created");
  assert(Number(state.rows[0].delivery_count) === 1, "payment commit did not create exactly one webhook outbox row");

  const rollbackClient = await pool.connect();
  try {
    await rollbackClient.query("BEGIN");
    await rollbackClient.query(
      `INSERT INTO ${events}(event_id, status, payload) VALUES ('rollback-event', 'processing', '{}')`,
    );
    await rollbackClient.query(`UPDATE ${balances} SET balance = balance + 500 WHERE store_id = 1`);
    throw new Error("simulated worker crash");
  } catch {
    await rollbackClient.query("ROLLBACK");
  } finally {
    rollbackClient.release();
  }
  const rollbackState = await pool.query(`
    SELECT
      (SELECT balance FROM ${balances} WHERE store_id = 1) balance,
      (SELECT COUNT(*) FROM ${events} WHERE event_id = 'rollback-event') event_count
  `);
  assert(Number(rollbackState.rows[0].balance) === 1000, "worker failure left a partial balance update");
  assert(Number(rollbackState.rows[0].event_count) === 0, "worker failure left a partial processing event");

  const payoutClaims = await Promise.all(
    Array.from({ length: 50 }, async (_, index) => {
      const result = await pool.query(
        `UPDATE ${payouts}
         SET status = 'submitting', claimed_by = $1
         WHERE id = 1 AND status = 'unpaid'
         RETURNING id`,
        [`worker-${index}`],
      );
      return result.rowCount;
    }),
  );
  assert(payoutClaims.reduce((sum, value) => sum + value, 0) === 1, "multiple payout workers claimed one payout");

  console.log(JSON.stringify({
    ok: true,
    duplicateAttempts: 50,
    creditedCount: 1,
    rollbackProtected: true,
    payoutClaimWinners: 1,
    webhookOutboxAtomic: true,
  }));
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${deliveries}, ${ledger}, ${events}, ${balances}, ${payouts}`);
  await pool.end();
}
