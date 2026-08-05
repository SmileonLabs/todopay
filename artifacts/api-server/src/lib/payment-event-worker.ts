import crypto from "node:crypto";
import {
  balanceRecordsTable,
  db,
  feeConfigsTable,
  membersTable,
  merchantFeeConfigsTable,
  merchantsTable,
  merchantWebhookDeliveriesTable,
  moneyLedgerTable,
  paymentIntentEventsTable,
  paymentIntentsTable,
  paymentEventsTable,
  pool,
  storeBalancesTable,
  transactionsTable,
  virtualAccountsTable,
  withdrawalsTable,
} from "@workspace/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { writeAuditLog } from "./audit.js";
import { logger } from "./logger.js";
import { calculateUsageFee } from "./money.js";
import { canApplyPayoutNotification, needsWithdrawalRefund, type WithdrawalState } from "./payment-state.js";
import {
  isPaymentIntentMerchantWebhookEnabled,
  isPaymentIntentPgProcessingEnabled,
  planPaymentIntentProviderEvent,
} from "./payment-intent-pg-processing.js";
import { buildPaymentIntentWebhook, type PaymentIntentWebhookType } from "./payment-intent-webhooks.js";

const workerId = `payment-event-${crypto.randomUUID()}`;
const maxAttempts = Math.max(1, Number(process.env.PAYMENT_EVENT_MAX_ATTEMPTS ?? 10));

const depositSchema = z.object({
  vactId: z.string().min(1),
  retry: z.coerce.number().int().nonnegative().optional(),
  mchtId: z.string().min(1),
  issueId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  trxType: z.enum(["deposit", "depositback"]),
  trackId: z.string().min(1),
}).passthrough();

const payoutSchema = z.object({
  trxId: z.string().min(1),
  mchtId: z.string().min(1),
  trackId: z.string().min(1),
  status: z.enum(["출금완료", "출금실패", "출금확인불가"]),
  resultCd: z.string().optional(),
  resultMsg: z.string().optional(),
  amount: z.coerce.number().int().positive().optional(),
}).passthrough();

type PaymentEventRow = typeof paymentEventsTable.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function enqueuePaymentIntentWebhook(
  tx: DbTransaction,
  input: {
    row: PaymentEventRow;
    intent: typeof paymentIntentsTable.$inferSelect;
    eventType: PaymentIntentWebhookType;
    status: string;
    receivedAmount: string;
    transactionId?: number | null;
    providerTransactionId?: string | null;
  },
) {
  if (!isPaymentIntentMerchantWebhookEnabled()) return;
  const [merchant] = await tx.select({ webhookUrl: merchantsTable.webhookUrl })
    .from(merchantsTable).where(eq(merchantsTable.id, input.intent.merchantId)).limit(1);
  if (!merchant?.webhookUrl) return;
  const eventId = `tdp_evt_pi_${input.row.id}_${input.eventType.replace(/[^a-z]/g, "_")}`;
  await tx.insert(merchantWebhookDeliveriesTable).values({
    eventId,
    merchantId: input.intent.merchantId,
    eventType: input.eventType,
    payload: buildPaymentIntentWebhook({
      eventId,
      eventType: input.eventType,
      paymentIntentId: input.intent.publicId,
      merchantOrderId: input.intent.merchantOrderId,
      externalCustomerId: input.intent.externalCustomerId,
      memberId: input.intent.memberId,
      amount: input.intent.amount,
      currency: "KRW",
      status: input.status,
      trackingNumber: input.intent.providerTrackingNumber,
      transactionId: input.transactionId ?? null,
      providerTransactionId: input.providerTransactionId ?? null,
      receivedAmount: input.receivedAmount,
    }),
  }).onConflictDoNothing({ target: merchantWebhookDeliveriesTable.eventId });
}

async function claimOne(): Promise<PaymentEventRow | null> {
  const result = await pool.query<{ id: number }>(
    `
      WITH candidate AS (
        SELECT id
        FROM payment_events
        WHERE (
          status IN ('received', 'retry')
          AND next_attempt_at <= NOW()
        ) OR (
          status = 'processing'
          AND locked_at < NOW() - INTERVAL '2 minutes'
        )
        ORDER BY next_attempt_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE payment_events event
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          locked_at = NOW(),
          locked_by = $1,
          last_error = NULL
      FROM candidate
      WHERE event.id = candidate.id
      RETURNING event.id
    `,
    [workerId],
  );
  const id = result.rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(paymentEventsTable).where(eq(paymentEventsTable.id, id)).limit(1);
  return row ?? null;
}

async function finishEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  eventId: number,
  status: "processed" | "duplicate",
  merchantId?: number | null,
): Promise<void> {
  await tx.update(paymentEventsTable).set({
    status,
    merchantId: merchantId ?? null,
    processedAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
  }).where(eq(paymentEventsTable.id, eventId));
}

async function processPaymentIntentDeposit(
  row: PaymentEventRow,
  intent: typeof paymentIntentsTable.$inferSelect,
  event: z.infer<typeof depositSchema>,
): Promise<{ resourceId: number | null; duplicate: boolean }> {
  const receivedAmount = String(event.amount);
  const action = planPaymentIntentProviderEvent({
    status: intent.status,
    expectedAmount: intent.amount,
    providerTrackingNumber: intent.providerTrackingNumber,
    notificationTrackId: event.trackId,
    notificationAmount: receivedAmount,
    transactionType: event.trxType,
  });
  if (action === "duplicate") {
    await db.transaction(async (tx) => finishEvent(tx, row.id, "duplicate", intent.merchantId));
    return { resourceId: intent.transactionId ?? intent.id, duplicate: true };
  }
  if (action === "reject") throw new Error("INVALID_PAYMENT_INTENT_PROVIDER_EVENT");

  let resourceId: number | null = null;
  await db.transaction(async (tx) => {
    if (action === "amount_mismatch") {
      const [changed] = await tx.update(paymentIntentsTable).set({
        status: "amount_mismatch",
        updatedAt: new Date(),
        version: sql`${paymentIntentsTable.version} + 1`,
      }).where(and(
        eq(paymentIntentsTable.id, intent.id),
        eq(paymentIntentsTable.status, "awaiting_deposit"),
        eq(paymentIntentsTable.providerTrackingNumber, event.trackId),
      )).returning();
      if (!changed) throw new Error("PAYMENT_INTENT_STATE_CONFLICT");
      await tx.insert(paymentIntentEventsTable).values({
        paymentIntentId: changed.id,
        eventType: "payment_intent.amount_mismatch",
        source: "kp_pay",
        sourceEventId: `kp-pay:${row.id}:amount-mismatch`,
        payload: { expectedAmount: changed.amount, receivedAmount, trackingNumber: event.trackId },
      });
      await enqueuePaymentIntentWebhook(tx, {
        row, intent: changed, eventType: "payment_intent.amount_mismatch",
        status: changed.status, receivedAmount, providerTransactionId: event.vactId,
      });
      await finishEvent(tx, row.id, "processed", changed.merchantId);
      resourceId = changed.id;
      return;
    }

    if (action === "complete") {
      const [claimed] = await tx.update(paymentIntentsTable).set({
        status: "processing",
        updatedAt: new Date(),
        version: sql`${paymentIntentsTable.version} + 1`,
      }).where(and(
        eq(paymentIntentsTable.id, intent.id),
        eq(paymentIntentsTable.status, "awaiting_deposit"),
        eq(paymentIntentsTable.amount, receivedAmount),
        eq(paymentIntentsTable.providerTrackingNumber, event.trackId),
      )).returning();
      if (!claimed?.memberId || !claimed.virtualAccountId) throw new Error("PAYMENT_INTENT_STATE_CONFLICT");
      const [[member], [account]] = await Promise.all([
        tx.select().from(membersTable).where(and(
          eq(membersTable.id, claimed.memberId),
          eq(membersTable.merchantId, claimed.merchantId),
          eq(membersTable.isActive, true),
          eq(membersTable.isVerified, true),
        )).limit(1),
        tx.select().from(virtualAccountsTable).where(and(
          eq(virtualAccountsTable.id, claimed.virtualAccountId),
          eq(virtualAccountsTable.merchantId, claimed.merchantId),
          eq(virtualAccountsTable.status, "active"),
        )).limit(1),
      ]);
      if (!member?.storeId || !account) throw new Error("PAYMENT_INTENT_MEMBER_OR_ACCOUNT_INVALID");
      const [[merchantFeeConfig], [legacyFeeConfig]] = await Promise.all([
        tx.select().from(merchantFeeConfigsTable)
          .where(eq(merchantFeeConfigsTable.merchantId, claimed.merchantId)).limit(1),
        tx.select().from(feeConfigsTable)
          .where(eq(feeConfigsTable.userId, member.storeId)).limit(1),
      ]);
      const feeConfig = merchantFeeConfig ?? legacyFeeConfig;
      if (!feeConfig) throw new Error("MISSING_MERCHANT_FEE_CONFIG");
      const fixedFee = Number(feeConfig.depositFee ?? 0);
      const usageFee = calculateUsageFee(event.amount, feeConfig.usageFeeRate ?? "0");
      const net = event.amount - fixedFee - usageFee;
      if (net < 0) throw new Error("INVALID_FEE");

      const [transaction] = await tx.insert(transactionsTable).values({
        type: "deposit",
        originalAmount: receivedAmount,
        amount: String(net),
        fee: String(fixedFee + usageFee),
        status: "success",
        fromAccount: "KPPAY",
        toAccount: account.accountNumber,
        trackingNumber: event.trackId,
        pgTransactionId: `PI-${claimed.publicId}`,
        providerEventId: event.vactId,
        idempotencyKey: `payment-intent:${claimed.publicId}`,
        memberId: claimed.memberId,
        merchantId: claimed.merchantId,
        paymentIntentId: claimed.id,
        processedAt: new Date(),
      }).returning();
      await tx.execute(sql`
        INSERT INTO store_balances (store_id, balance, updated_at)
        VALUES (${member.storeId}, ${net}, NOW())
        ON CONFLICT (store_id) DO UPDATE
        SET balance = store_balances.balance + ${net}, updated_at = NOW()
      `);
      await tx.insert(moneyLedgerTable).values({
        storeId: member.storeId,
        merchantId: claimed.merchantId,
        direction: "credit",
        amount: String(net),
        entryType: "deposit_credit",
        referenceType: "transaction",
        referenceId: transaction.id,
      });
      await tx.insert(balanceRecordsTable).values({
        userId: member.storeId,
        merchantId: claimed.merchantId,
        direction: "in",
        category: "deposit",
        amount: String(net),
        balance: "0",
        description: `PG payment intent ${claimed.publicId}`,
      });
      const [succeeded] = await tx.update(paymentIntentsTable).set({
        status: "succeeded",
        transactionId: transaction.id,
        succeededAt: new Date(),
        updatedAt: new Date(),
        version: sql`${paymentIntentsTable.version} + 1`,
      }).where(and(
        eq(paymentIntentsTable.id, claimed.id),
        eq(paymentIntentsTable.status, "processing"),
      )).returning();
      if (!succeeded) throw new Error("PAYMENT_INTENT_FINALIZE_FAILED");
      await tx.insert(paymentIntentEventsTable).values({
        paymentIntentId: succeeded.id,
        eventType: "payment_intent.succeeded",
        source: "kp_pay",
        sourceEventId: `kp-pay:${row.id}:succeeded`,
        payload: { transactionId: transaction.id, amount: receivedAmount, trackingNumber: event.trackId },
      });
      await enqueuePaymentIntentWebhook(tx, {
        row, intent: succeeded, eventType: "payment_intent.succeeded",
        status: succeeded.status, receivedAmount, transactionId: transaction.id,
        providerTransactionId: event.vactId,
      });
      await finishEvent(tx, row.id, "processed", succeeded.merchantId);
      resourceId = transaction.id;
      return;
    }

    if (!intent.transactionId || !intent.memberId) throw new Error("PAYMENT_INTENT_REVERSAL_MISSING_TRANSACTION");
    const [claimed] = await tx.update(paymentIntentsTable).set({
      status: "reversed",
      reversedAt: new Date(),
      updatedAt: new Date(),
      version: sql`${paymentIntentsTable.version} + 1`,
    }).where(and(
      eq(paymentIntentsTable.id, intent.id),
      eq(paymentIntentsTable.status, "succeeded"),
      eq(paymentIntentsTable.amount, receivedAmount),
      eq(paymentIntentsTable.providerTrackingNumber, event.trackId),
    )).returning();
    if (!claimed) throw new Error("PAYMENT_INTENT_STATE_CONFLICT");
    const [[transaction], [member]] = await Promise.all([
      tx.select().from(transactionsTable).where(and(
        eq(transactionsTable.id, intent.transactionId),
        eq(transactionsTable.paymentIntentId, intent.id),
        eq(transactionsTable.status, "success"),
      )).limit(1),
      tx.select().from(membersTable).where(and(
        eq(membersTable.id, intent.memberId),
        eq(membersTable.merchantId, intent.merchantId),
      )).limit(1),
    ]);
    if (!transaction || !member?.storeId) throw new Error("PAYMENT_INTENT_REVERSAL_INVALID_TRANSACTION");
    const net = transaction.amount;
    const [debited] = await tx.update(storeBalancesTable).set({
      balance: sql`${storeBalancesTable.balance} - ${net}`,
      updatedAt: new Date(),
    }).where(and(
      eq(storeBalancesTable.storeId, member.storeId),
      gte(storeBalancesTable.balance, net),
    )).returning({ storeId: storeBalancesTable.storeId });
    if (!debited) throw new Error("INSUFFICIENT_BALANCE_FOR_REVERSAL");
    await tx.update(transactionsTable).set({ status: "failed", processedAt: new Date() })
      .where(and(eq(transactionsTable.id, transaction.id), eq(transactionsTable.status, "success")));
    await tx.insert(moneyLedgerTable).values({
      storeId: member.storeId,
      merchantId: intent.merchantId,
      direction: "debit",
      amount: net,
      entryType: "deposit_reversal",
      referenceType: "transaction",
      referenceId: transaction.id,
    }).onConflictDoNothing();
    await tx.insert(balanceRecordsTable).values({
      userId: member.storeId,
      merchantId: intent.merchantId,
      direction: "out",
      category: "refund",
      amount: net,
      balance: "0",
      description: `PG payment intent reversal ${intent.publicId}`,
    });
    await tx.insert(paymentIntentEventsTable).values({
      paymentIntentId: claimed.id,
      eventType: "payment_intent.reversed",
      source: "kp_pay",
      sourceEventId: `kp-pay:${row.id}:reversed`,
      payload: { transactionId: transaction.id, amount: receivedAmount, trackingNumber: event.trackId },
    });
    await enqueuePaymentIntentWebhook(tx, {
      row, intent: claimed, eventType: "payment_intent.reversed",
      status: claimed.status, receivedAmount, transactionId: transaction.id,
      providerTransactionId: event.vactId,
    });
    await finishEvent(tx, row.id, "processed", claimed.merchantId);
    resourceId = transaction.id;
  });
  return { resourceId, duplicate: false };
}

async function processDeposit(row: PaymentEventRow): Promise<{ resourceId: number | null; duplicate: boolean }> {
  const event = depositSchema.parse(row.payload);
  if (isPaymentIntentPgProcessingEnabled()) {
    const [intent] = await db.select().from(paymentIntentsTable)
      .where(eq(paymentIntentsTable.providerTrackingNumber, event.trackId)).limit(1);
    if (intent) return processPaymentIntentDeposit(row, intent, event);
  }
  let resourceId: number | null = null;
  let duplicate = false;
  await db.transaction(async (tx) => {
    const [transaction] = await tx.select().from(transactionsTable).where(and(
      eq(transactionsTable.trackingNumber, event.trackId),
      eq(transactionsTable.type, "deposit"),
    )).limit(1);
    if (
      !transaction
      || Number(transaction.originalAmount) !== event.amount
      || !transaction.memberId
      || !transaction.merchantId
    ) throw new Error("UNMATCHED_OR_INVALID_DEPOSIT");

    if (
      (event.trxType === "deposit" && transaction.status === "success")
      || (event.trxType === "depositback" && transaction.status === "failed")
    ) {
      duplicate = true;
      resourceId = transaction.id;
      await finishEvent(tx, row.id, "duplicate", transaction.merchantId);
      return;
    }

    const [member] = await tx.select().from(membersTable)
      .where(eq(membersTable.id, transaction.memberId)).limit(1);
    if (!member?.storeId) throw new Error("MISSING_STORE");
    const [[merchantFeeConfig], [legacyFeeConfig]] = await Promise.all([
      tx.select().from(merchantFeeConfigsTable)
        .where(eq(merchantFeeConfigsTable.merchantId, transaction.merchantId)).limit(1),
      tx.select().from(feeConfigsTable)
        .where(eq(feeConfigsTable.userId, member.storeId)).limit(1),
    ]);
    const feeConfig = merchantFeeConfig ?? legacyFeeConfig;
    if (!feeConfig) throw new Error("MISSING_MERCHANT_FEE_CONFIG");
    const fixedFee = Number(feeConfig.depositFee ?? 0);
    const usageFee = calculateUsageFee(event.amount, feeConfig.usageFeeRate ?? "0");
    const net = event.amount - fixedFee - usageFee;
    if (net < 0) throw new Error("INVALID_FEE");

    if (event.trxType === "deposit") {
      const [changed] = await tx.update(transactionsTable).set({
        status: "success",
        fee: String(fixedFee + usageFee),
        amount: String(net),
        providerEventId: event.vactId,
        processedAt: new Date(),
      }).where(and(
        eq(transactionsTable.id, transaction.id),
        eq(transactionsTable.status, "pending"),
        isNull(transactionsTable.providerEventId),
      )).returning();
      if (!changed) throw new Error("INVALID_DEPOSIT_STATE");
      await tx.execute(sql`
        INSERT INTO store_balances (store_id, balance, updated_at)
        VALUES (${member.storeId}, ${net}, NOW())
        ON CONFLICT (store_id) DO UPDATE
        SET balance = store_balances.balance + ${net}, updated_at = NOW()
      `);
      await tx.insert(moneyLedgerTable).values({
        storeId: member.storeId,
        merchantId: transaction.merchantId,
        direction: "credit",
        amount: String(net),
        entryType: "deposit_credit",
        referenceType: "transaction",
        referenceId: transaction.id,
      });
      await tx.insert(balanceRecordsTable).values({
        userId: member.storeId,
        merchantId: transaction.merchantId,
        direction: "in",
        category: "deposit",
        amount: String(net),
        balance: "0",
        description: `PG deposit ${transaction.trackingNumber}`,
      });
      const outboundId = `tdp_evt_kppay_${row.id}`;
      await tx.insert(merchantWebhookDeliveriesTable).values({
        eventId: outboundId,
        merchantId: transaction.merchantId,
        eventType: "deposit.completed",
        payload: {
          id: outboundId,
          type: "deposit.completed",
          createdAt: new Date().toISOString(),
          data: {
            transactionId: changed.id,
            trackingNumber: transaction.trackingNumber,
            paymentAmount: event.amount,
            fee: fixedFee + usageFee,
            settlementAmount: net,
            status: "success",
            providerTransactionId: event.vactId,
          },
        },
      });
      resourceId = changed.id;
    } else {
      const [changed] = await tx.update(transactionsTable).set({
        status: "failed",
        providerEventId: event.vactId,
        processedAt: new Date(),
      }).where(and(
        eq(transactionsTable.id, transaction.id),
        eq(transactionsTable.status, "success"),
      )).returning();
      if (!changed) throw new Error("INVALID_REVERSAL_STATE");
      const [debited] = await tx.update(storeBalancesTable).set({
        balance: sql`${storeBalancesTable.balance} - ${net}`,
        updatedAt: new Date(),
      }).where(and(
        eq(storeBalancesTable.storeId, member.storeId),
        gte(storeBalancesTable.balance, String(net)),
      )).returning({ storeId: storeBalancesTable.storeId });
      if (!debited) throw new Error("INSUFFICIENT_BALANCE_FOR_REVERSAL");
      await tx.insert(moneyLedgerTable).values({
        storeId: member.storeId,
        merchantId: transaction.merchantId,
        direction: "debit",
        amount: String(net),
        entryType: "deposit_reversal",
        referenceType: "transaction",
        referenceId: transaction.id,
      }).onConflictDoNothing();
      const outboundId = `tdp_evt_kppay_${row.id}`;
      await tx.insert(merchantWebhookDeliveriesTable).values({
        eventId: outboundId,
        merchantId: transaction.merchantId,
        eventType: "deposit.reversed",
        payload: {
          id: outboundId,
          type: "deposit.reversed",
          createdAt: new Date().toISOString(),
          data: {
            transactionId: changed.id,
            trackingNumber: transaction.trackingNumber,
            paymentAmount: event.amount,
            fee: fixedFee + usageFee,
            settlementAmount: net,
            status: "failed",
            providerTransactionId: event.vactId,
          },
        },
      });
      resourceId = changed.id;
    }
    await finishEvent(tx, row.id, "processed", transaction.merchantId);
  });
  return { resourceId, duplicate };
}

async function processPayout(row: PaymentEventRow): Promise<{ resourceId: number | null; duplicate: boolean }> {
  const event = payoutSchema.parse(row.payload);
  const nextStatus: WithdrawalState = event.status === "출금완료"
    ? "paid"
    : event.status === "출금실패" ? "failed" : "unknown";
  let resourceId: number | null = null;
  let duplicate = false;
  await db.transaction(async (tx) => {
    const [withdrawal] = await tx.select().from(withdrawalsTable)
      .where(eq(withdrawalsTable.trackingNumber, event.trackId)).limit(1);
    if (!withdrawal?.merchantId) throw new Error("UNMATCHED_PAYOUT");
    if (event.amount !== undefined && Number(withdrawal.totalAmount) !== event.amount) {
      throw new Error("PAYOUT_AMOUNT_MISMATCH");
    }
    if (withdrawal.withdrawalStatus === nextStatus) {
      duplicate = true;
      resourceId = withdrawal.id;
      await finishEvent(tx, row.id, "duplicate", withdrawal.merchantId);
      return;
    }
    if (!canApplyPayoutNotification(
      withdrawal.approvalStatus,
      withdrawal.withdrawalStatus as WithdrawalState,
      nextStatus,
    )) throw new Error("INVALID_PAYOUT_STATE");

    const [changed] = await tx.update(withdrawalsTable).set({
      withdrawalStatus: nextStatus,
      providerTransactionId: event.trxId,
      providerResultCode: event.resultCd ?? null,
      providerResultMessage: event.resultMsg ?? null,
      providerUpdatedAt: new Date(),
      paidAt: nextStatus === "paid" ? new Date() : withdrawal.paidAt,
      submissionClaimedAt: null,
      submissionClaimedBy: null,
    }).where(eq(withdrawalsTable.id, withdrawal.id)).returning();
    if (!changed) throw new Error("PAYOUT_UPDATE_FAILED");

    if (needsWithdrawalRefund(nextStatus) && withdrawal.storeId) {
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
        await tx.insert(balanceRecordsTable).values({
          userId: withdrawal.storeId,
          merchantId: withdrawal.merchantId,
          direction: "in",
          category: "refund",
          amount: withdrawal.amount,
          balance: "0",
          description: `PG payout refund ${withdrawal.trackingNumber}`,
        });
      }
    }

    const eventType = nextStatus === "paid"
      ? "payout.completed"
      : nextStatus === "failed" ? "payout.failed" : "payout.unknown";
    const outboundId = `tdp_evt_kppay_${row.id}`;
    await tx.insert(merchantWebhookDeliveriesTable).values({
      eventId: outboundId,
      merchantId: withdrawal.merchantId,
      eventType,
      payload: {
        id: outboundId,
        type: eventType,
        createdAt: new Date().toISOString(),
        data: {
          withdrawalId: changed.id,
          trackingNumber: withdrawal.trackingNumber,
          withdrawalAmount: Number(withdrawal.amount),
          fee: Number(withdrawal.fee),
          totalAmount: Number(withdrawal.totalAmount),
          status: nextStatus,
          providerTransactionId: event.trxId,
          resultCode: event.resultCd ?? null,
          resultMessage: event.resultMsg ?? null,
        },
      },
    });
    resourceId = changed.id;
    await finishEvent(tx, row.id, "processed", withdrawal.merchantId);
  });
  return { resourceId, duplicate };
}

async function failEvent(row: PaymentEventRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown payment event error";
  const dead = row.attemptCount >= maxAttempts;
  const delaySeconds = Math.min(15 * 60, 2 ** Math.min(row.attemptCount, 9));
  await db.update(paymentEventsTable).set({
    status: dead ? "dead" : "retry",
    nextAttemptAt: dead ? new Date() : new Date(Date.now() + delaySeconds * 1_000),
    lockedAt: null,
    lockedBy: null,
    lastError: message.slice(0, 1_000),
  }).where(eq(paymentEventsTable.id, row.id));
  logger[dead ? "error" : "warn"](
    { err: error, paymentEventId: row.id, attemptCount: row.attemptCount },
    dead ? "Payment event moved to DLQ" : "Payment event scheduled for retry",
  );
}

async function processOne(row: PaymentEventRow): Promise<void> {
  try {
    const result = row.eventType.startsWith("payout:")
      ? await processPayout(row)
      : await processDeposit(row);
    await writeAuditLog(undefined, {
      actorType: "system",
      action: result.duplicate ? "kp_pay.event.duplicate" : "kp_pay.event.processed",
      resourceType: row.eventType.startsWith("payout:") ? "withdrawal" : "transaction",
      resourceId: result.resourceId,
      metadata: {
        paymentEventId: row.id,
        providerEventId: row.eventId,
        eventType: row.eventType,
        trackingNumber: row.trackingNumber,
      },
    });
  } catch (error) {
    await failEvent(row, error);
  }
}

export function startPaymentEventWorker() {
  if (process.env.PAYMENT_EVENT_WORKER_ENABLED !== "true") {
    logger.info("Payment event worker is disabled");
    return () => undefined;
  }
  const intervalMs = Math.max(250, Number(process.env.PAYMENT_EVENT_WORKER_INTERVAL_MS ?? 500));
  const concurrency = Math.max(1, Math.min(20, Number(process.env.PAYMENT_EVENT_WORKER_CONCURRENCY ?? 5)));
  let running = false;
  let stopped = false;
  const poll = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const claimed = await Promise.all(Array.from({ length: concurrency }, () => claimOne()));
      await Promise.all(claimed.filter((row): row is PaymentEventRow => row !== null).map(processOne));
    } catch (error) {
      logger.error({ err: error }, "Payment event worker poll failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  void poll();
  logger.info({ workerId, intervalMs, concurrency }, "Payment event worker started");
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
