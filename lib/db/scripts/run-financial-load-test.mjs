import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 40 });
const suffix = crypto.randomBytes(6).toString("hex");
const events = `financial_load_events_${suffix}`;
const balances = `financial_load_balances_${suffix}`;
const ledger = `financial_load_ledger_${suffix}`;

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function runLevel(count) {
  await pool.query(`TRUNCATE ${events}, ${ledger}, ${balances}`);
  await pool.query(
    `INSERT INTO ${balances}(store_id, balance)
     SELECT value, 0 FROM generate_series(1, 100) value`,
  );
  const latencies = [];
  let errors = 0;
  const started = performance.now();
  const jobs = Array.from({ length: count }, (_, index) => {
    // Ten percent are deliberate redeliveries.
    const logicalId = index > 0 && index % 10 === 0 ? index - 1 : index;
    const eventId = `level-${count}-event-${logicalId}`;
    const storeId = (logicalId % 100) + 1;
    return async () => {
      const begin = performance.now();
      try {
        await pool.query(
          `
            WITH accepted AS (
              INSERT INTO ${events}(event_id, received_at)
              VALUES ($1, NOW())
              ON CONFLICT DO NOTHING
              RETURNING event_id
            ),
            written AS (
              INSERT INTO ${ledger}(event_id, store_id, amount)
              SELECT event_id, $2, 1000 FROM accepted
              ON CONFLICT DO NOTHING
              RETURNING store_id, amount
            )
            UPDATE ${balances} balance
            SET balance = balance.balance + written.amount
            FROM written
            WHERE balance.store_id = written.store_id
          `,
          [eventId, storeId],
        );
      } catch {
        errors += 1;
      } finally {
        latencies.push(performance.now() - begin);
      }
    };
  });

  // Bound client-side concurrency so the result measures DB saturation rather
  // than allocating thousands of sockets at once.
  let cursor = 0;
  const runners = Array.from({ length: Math.min(100, count) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      await job();
    }
  });
  await Promise.all(runners);
  const elapsedMs = performance.now() - started;
  const accepted = Number((await pool.query(`SELECT COUNT(*) count FROM ${events}`)).rows[0].count);
  const ledgerCount = Number((await pool.query(`SELECT COUNT(*) count FROM ${ledger}`)).rows[0].count);
  const balanceTotal = Number((await pool.query(`SELECT SUM(balance) total FROM ${balances}`)).rows[0].total);
  if (accepted !== ledgerCount || balanceTotal !== ledgerCount * 1000) {
    throw new Error(`integrity mismatch at level ${count}`);
  }
  return {
    requests: count,
    accepted,
    duplicates: count - accepted,
    errors,
    elapsedMs: Math.round(elapsedMs),
    throughputPerSecond: Math.round((count / elapsedMs) * 1000),
    p50Ms: Math.round(percentile(latencies, 0.5)),
    p95Ms: Math.round(percentile(latencies, 0.95)),
    p99Ms: Math.round(percentile(latencies, 0.99)),
    passed: errors === 0 && percentile(latencies, 0.95) < 500,
  };
}

try {
  await pool.query(`
    CREATE UNLOGGED TABLE ${events} (
      event_id text PRIMARY KEY,
      received_at timestamp NOT NULL
    );
    CREATE UNLOGGED TABLE ${balances} (
      store_id integer PRIMARY KEY,
      balance bigint NOT NULL
    );
    CREATE UNLOGGED TABLE ${ledger} (
      event_id text PRIMARY KEY,
      store_id integer NOT NULL,
      amount bigint NOT NULL
    );
  `);
  // Production tasks keep a warm pool. Exclude TLS connection establishment
  // from steady-state event latency while still reporting it separately.
  const coldStart = performance.now();
  await Promise.all(Array.from({ length: 40 }, () => pool.query("SELECT 1")));
  const poolWarmupMs = Math.round(performance.now() - coldStart);
  const results = [];
  for (const level of [100, 500, 1000]) results.push(await runLevel(level));
  console.log(JSON.stringify({ ok: results.every((item) => item.passed), poolWarmupMs, results }));
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${ledger}, ${events}, ${balances}`);
  await pool.end();
}
