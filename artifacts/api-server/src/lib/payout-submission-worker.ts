import crypto from "node:crypto";
import {
  db,
  moneyLedgerTable,
  pool,
  storeBalancesTable,
  withdrawalsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { KpPayClient, KpPayError } from "./kp-pay-client.js";
import { logger } from "./logger.js";

const workerId = `payout-${crypto.randomUUID()}`;
const maxAttempts = Math.max(1, Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 5));
const staleClaimMs = Math.max(60_000, Number(process.env.PAYOUT_STALE_CLAIM_MS ?? 5 * 60_000));

type ClaimedPayout = typeof withdrawalsTable.$inferSelect;

function normalizeHolderName(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

const payoutBankCodes: Record<string, string> = {
  국민: "004", 신한: "088", 우리: "020", 하나: "081", 농협: "011",
  기업: "003", 부산: "032", 대구: "031", 광주: "034", 제주: "035",
  전북: "037", 경남: "039", 수협: "007", 산업: "002", 새마을: "045",
  신협: "048", 우체국: "071", 카카오뱅크: "090", 케이뱅크: "089", 토스뱅크: "092",
};

async function claimOne(): Promise<ClaimedPayout | null> {
  const result = await pool.query<{ id: number }>(
    `
      WITH candidate AS (
        SELECT id
        FROM withdrawals
        WHERE approval_status = 'approved'
          AND withdrawal_status = 'unpaid'
          AND next_submission_at <= NOW()
        ORDER BY next_submission_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE withdrawals payout
      SET withdrawal_status = 'submitting',
          submission_attempt_count = submission_attempt_count + 1,
          submission_claimed_at = NOW(),
          submission_claimed_by = $1,
          submission_last_error = NULL,
          provider_updated_at = NOW()
      FROM candidate
      WHERE payout.id = candidate.id
      RETURNING payout.id
    `,
    [workerId],
  );
  const id = result.rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
  return row ?? null;
}

async function refundUnsubmittedPayout(withdrawal: ClaimedPayout, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [failed] = await tx.update(withdrawalsTable).set({
      withdrawalStatus: "failed",
      submissionLastError: reason.slice(0, 500),
      providerResultMessage: reason.slice(0, 200),
      providerUpdatedAt: new Date(),
      submissionClaimedAt: null,
      submissionClaimedBy: null,
    }).where(and(
      eq(withdrawalsTable.id, withdrawal.id),
      eq(withdrawalsTable.withdrawalStatus, "submitting"),
    )).returning({ id: withdrawalsTable.id });
    if (!failed || !withdrawal.storeId) return;

    const [refund] = await tx.insert(moneyLedgerTable).values({
      storeId: withdrawal.storeId,
      merchantId: withdrawal.merchantId,
      direction: "credit",
      amount: withdrawal.amount,
      entryType: "withdrawal_refund",
      referenceType: "withdrawal",
      referenceId: withdrawal.id,
    }).onConflictDoNothing().returning({ id: moneyLedgerTable.id });
    if (refund) {
      await tx.execute(sql`
        UPDATE store_balances
        SET balance = balance + ${withdrawal.amount}, updated_at = NOW()
        WHERE store_id = ${withdrawal.storeId}
      `);
    }
  });
}

async function retryKnownFailure(withdrawal: ClaimedPayout, error: Error): Promise<void> {
  if (withdrawal.submissionAttemptCount >= maxAttempts) {
    await refundUnsubmittedPayout(withdrawal, error.message);
    return;
  }
  const delaySeconds = Math.min(15 * 60, 15 * 2 ** Math.max(0, withdrawal.submissionAttemptCount - 1));
  await db.update(withdrawalsTable).set({
    withdrawalStatus: "unpaid",
    submissionLastError: error.message.slice(0, 500),
    nextSubmissionAt: sql`NOW() + (${delaySeconds} * INTERVAL '1 second')`,
    submissionClaimedAt: null,
    submissionClaimedBy: null,
    providerUpdatedAt: new Date(),
  }).where(and(
    eq(withdrawalsTable.id, withdrawal.id),
    eq(withdrawalsTable.withdrawalStatus, "submitting"),
  ));
}

async function markAmbiguous(withdrawal: ClaimedPayout, error: Error): Promise<void> {
  await db.update(withdrawalsTable).set({
    withdrawalStatus: "unknown",
    submissionLastError: error.message.slice(0, 500),
    providerResultMessage: "Provider outcome requires reconciliation",
    providerUpdatedAt: new Date(),
    submissionClaimedAt: null,
    submissionClaimedBy: null,
  }).where(and(
    eq(withdrawalsTable.id, withdrawal.id),
    eq(withdrawalsTable.withdrawalStatus, "submitting"),
  ));
}

async function submitOne(withdrawal: ClaimedPayout): Promise<void> {
  const bankCode = payoutBankCodes[withdrawal.accountBank]
    ?? (/^\d{3}$/.test(withdrawal.accountBank) ? withdrawal.accountBank : undefined);
  if (!bankCode) {
    await refundUnsubmittedPayout(withdrawal, "Payout bank code is not configured");
    return;
  }

  const client = new KpPayClient();
  try {
    const account = await client.checkPayoutAccount({
      account: withdrawal.accountNumber,
      bankCd: bankCode,
    });
    if (
      account.accnt.holder
      && normalizeHolderName(account.accnt.holder) !== normalizeHolderName(withdrawal.accountHolder)
    ) {
      await refundUnsubmittedPayout(withdrawal, "Payout account holder does not match");
      return;
    }

    const provider = await client.requestPayout({
      account: withdrawal.accountNumber,
      bankCd: bankCode,
      amount: Number(withdrawal.totalAmount),
      trackId: withdrawal.trackingNumber,
      recordInfo: "TodoPay",
    });

    await db.update(withdrawalsTable).set({
      withdrawalStatus: "processing",
      providerTransactionId: provider.transfer.trxId,
      providerUpdatedAt: new Date(),
      submissionClaimedAt: null,
      submissionClaimedBy: null,
      submissionLastError: null,
    }).where(and(
      eq(withdrawalsTable.id, withdrawal.id),
      eq(withdrawalsTable.withdrawalStatus, "submitting"),
    ));
    logger.info({ withdrawalId: withdrawal.id, trackId: withdrawal.trackingNumber }, "Payout submitted");
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("Unknown payout submission error");
    if (error instanceof KpPayError && error.outcomeUnknown) {
      await markAmbiguous(withdrawal, normalized);
      logger.error({ err: error, withdrawalId: withdrawal.id }, "Payout outcome is ambiguous; automatic retry blocked");
      return;
    }
    await retryKnownFailure(withdrawal, normalized);
    logger.warn({ err: error, withdrawalId: withdrawal.id }, "Known payout submission failure scheduled safely");
  }
}

async function quarantineStaleClaims(): Promise<void> {
  await pool.query(
    `
      UPDATE withdrawals
      SET withdrawal_status = 'unknown',
          submission_last_error = 'Worker stopped while payout submission was in progress',
          provider_result_message = 'Provider outcome requires reconciliation',
          provider_updated_at = NOW(),
          submission_claimed_at = NULL,
          submission_claimed_by = NULL
      WHERE withdrawal_status = 'submitting'
        AND submission_claimed_at < NOW() - ($1 * INTERVAL '1 millisecond')
    `,
    [staleClaimMs],
  );
}

export function startPayoutSubmissionWorker() {
  if (process.env.PAYOUT_WORKER_ENABLED !== "true") {
    logger.info("Payout submission worker is disabled");
    return () => undefined;
  }
  const intervalMs = Math.max(500, Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1_000));
  let running = false;
  let stopped = false;
  const poll = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await quarantineStaleClaims();
      for (let count = 0; count < 5; count += 1) {
        const payout = await claimOne();
        if (!payout) break;
        await submitOne(payout);
      }
    } catch (error) {
      logger.error({ err: error }, "Payout submission worker poll failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  void poll();
  logger.info({ workerId, intervalMs }, "Payout submission worker started");
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
