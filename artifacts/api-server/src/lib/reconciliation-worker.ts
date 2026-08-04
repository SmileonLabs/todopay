import {
  db,
  pool,
  reconciliationRunsTable,
  type PoolClient,
} from "@workspace/db";
import { KpPayClient } from "./kp-pay-client.js";
import { logger } from "./logger.js";

type CountRow = { count: number | string };
const RECONCILIATION_ADVISORY_LOCK_ID = 20_260_729;

async function scalar(sql: string): Promise<number> {
  const result = await pool.query<CountRow>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

export async function runFinancialReconciliation() {
  const [
    balanceMismatchCount,
    successfulDepositsWithoutLedger,
    depositLedgersWithoutSuccess,
    staleEventCount,
    stalePayoutCount,
    deadEventCount,
  ] = await Promise.all([
    scalar(`
      WITH ledger AS (
        SELECT store_id,
               SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) expected
        FROM money_ledger GROUP BY store_id
      )
      SELECT COUNT(*) count
      FROM store_balances balance
      LEFT JOIN ledger USING (store_id)
      WHERE balance.balance <> COALESCE(ledger.expected, 0)
    `),
    scalar(`
      SELECT COUNT(*) count
      FROM transactions transaction
      WHERE transaction.type = 'deposit'
        AND transaction.status = 'success'
        AND NOT EXISTS (
          SELECT 1 FROM money_ledger ledger
          WHERE ledger.reference_type = 'transaction'
            AND ledger.reference_id = transaction.id
            AND ledger.entry_type = 'deposit_credit'
        )
    `),
    scalar(`
      SELECT COUNT(*) count
      FROM money_ledger ledger
      LEFT JOIN transactions transaction
        ON ledger.reference_type = 'transaction'
       AND ledger.reference_id = transaction.id
      WHERE ledger.entry_type = 'deposit_credit'
        AND (transaction.id IS NULL OR transaction.status <> 'success')
    `),
    scalar(`
      SELECT COUNT(*) count
      FROM payment_events
      WHERE status IN ('received', 'retry', 'processing')
        AND received_at < NOW() - INTERVAL '15 minutes'
    `),
    scalar(`
      SELECT COUNT(*) count
      FROM withdrawals
      WHERE withdrawal_status IN ('submitting', 'processing', 'unknown')
        AND COALESCE(provider_updated_at, created_at) < NOW() - INTERVAL '15 minutes'
    `),
    scalar(`SELECT COUNT(*) count FROM payment_events WHERE status = 'dead'`),
  ]);

  let providerBalance: string | null = null;
  let providerBalanceError: string | null = null;
  if (process.env.PAYMENT_PROVIDER_ENABLED === "true") {
    try {
      const response = await new KpPayClient().getPayoutBalance();
      providerBalance = String(response.balance.available ?? response.balance.balance);
    } catch (error) {
      providerBalanceError = error instanceof Error ? error.message : "Unknown KPPay balance error";
    }
  }

  const ledgerMismatchCount = successfulDepositsWithoutLedger + depositLedgersWithoutSuccess;
  const unhealthy =
    balanceMismatchCount
    + ledgerMismatchCount
    + staleEventCount
    + stalePayoutCount
    + deadEventCount;
  const status = unhealthy > 0 ? "warning" : "healthy";
  const details = {
    successfulDepositsWithoutLedger,
    depositLedgersWithoutSuccess,
    providerBalanceError,
    note: "KPPay exposes aggregate balance but no per-transfer inquiry API; unknown payouts require provider confirmation.",
  };
  const [run] = await db.insert(reconciliationRunsTable).values({
    status,
    balanceMismatchCount,
    ledgerMismatchCount,
    staleEventCount,
    stalePayoutCount,
    deadEventCount,
    providerBalance,
    details,
  }).returning();

  const log = status === "healthy" ? logger.info.bind(logger) : logger.error.bind(logger);
  log({
    reconciliationRunId: run.id,
    status,
    balanceMismatchCount,
    ledgerMismatchCount,
    staleEventCount,
    stalePayoutCount,
    deadEventCount,
    providerBalance,
    providerBalanceError,
  }, "Financial reconciliation completed");
  return run;
}

export function startReconciliationWorker() {
  if (process.env.RECONCILIATION_WORKER_ENABLED !== "true") {
    logger.info("Financial reconciliation worker is disabled");
    return () => undefined;
  }
  const intervalMs = Math.max(60_000, Number(process.env.RECONCILIATION_INTERVAL_MS ?? 15 * 60_000));
  let running = false;
  let stopped = false;
  let leaderClient: PoolClient | null = null;

  const run = async () => {
    if (running || stopped || !leaderClient) return;
    running = true;
    try {
      await leaderClient.query("SELECT 1");
      await runFinancialReconciliation();
    } catch (error) {
      logger.error({ err: error }, "Financial reconciliation failed");
    } finally {
      running = false;
    }
  };

  const acquireLeadership = async () => {
    if (stopped || leaderClient) return;
    let candidate: PoolClient | null = null;
    try {
      candidate = await pool.connect();
      const lock = await candidate.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) acquired",
        [RECONCILIATION_ADVISORY_LOCK_ID],
      );
      if (lock.rows[0]?.acquired !== true) return;
      leaderClient = candidate;
      candidate = null;
      leaderClient.on("error", (error: Error) => {
        logger.error({ err: error }, "Financial reconciliation leadership connection failed");
        leaderClient = null;
      });
      logger.info({ intervalMs }, "Financial reconciliation leadership acquired");
      void run();
    } catch (error) {
      logger.error({ err: error }, "Failed to acquire financial reconciliation leadership");
    } finally {
      candidate?.release();
    }
  };

  const runTimer = setInterval(() => void run(), intervalMs);
  const electionTimer = setInterval(() => void acquireLeadership(), 30_000);
  runTimer.unref();
  electionTimer.unref();
  void acquireLeadership();

  return () => {
    stopped = true;
    clearInterval(runTimer);
    clearInterval(electionTimer);
    const currentLeader = leaderClient;
    leaderClient = null;
    if (currentLeader) {
      void currentLeader
        .query("SELECT pg_advisory_unlock($1)", [RECONCILIATION_ADVISORY_LOCK_ID])
        .catch((error: unknown) => logger.error({ err: error }, "Failed to release reconciliation leadership"))
        .finally(() => currentLeader.release());
    }
  };
}
