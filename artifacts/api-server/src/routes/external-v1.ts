import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  adminUsersTable,
  membersTable,
  merchantFeeConfigsTable,
  moneyLedgerTable,
  paymentIntentEventsTable,
  paymentIntentsTable,
  paymentEventsTable,
  transactionsTable,
  virtualAccountIssuancesTable,
  virtualAccountsTable,
  withdrawalsTable,
} from "@workspace/db";
import { allowRequest } from "../lib/rate-limit.js";
import { hashPassword } from "../lib/auth.js";
import { requireMerchantApi } from "../lib/merchant-api-auth.js";
import { KpPayClient, KpPayError } from "../lib/kp-pay-client.js";
import { logger } from "../lib/logger.js";
import { isPaymentIntentMemberReplay } from "../lib/payment-intent-state.js";
import { createPaymentIntentTrackId } from "../lib/payment-intent-pg-binding.js";

const router = Router();

function pageValue(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function dateValue(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value: unknown, maximum = 100): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function paymentIntentResponse(
  intent: typeof paymentIntentsTable.$inferSelect,
  account: typeof virtualAccountsTable.$inferSelect | null,
) {
  return {
    id: intent.publicId,
    merchantOrderId: intent.merchantOrderId,
    attemptNumber: intent.attemptNumber,
    externalCustomerId: intent.externalCustomerId,
    memberId: intent.memberId,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
    trackingNumber: intent.providerTrackingNumber,
    expiresAt: intent.expiresAt.toISOString(),
    virtualAccount: account ? {
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      status: account.status,
    } : null,
    description: intent.description,
    metadata: intent.metadata,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

async function intentAccount(intent: typeof paymentIntentsTable.$inferSelect) {
  if (!intent.virtualAccountId) return null;
  const [account] = await db.select().from(virtualAccountsTable).where(and(
    eq(virtualAccountsTable.id, intent.virtualAccountId),
    eq(virtualAccountsTable.merchantId, intent.merchantId),
  )).limit(1);
  return account ?? null;
}

function storeCodesValue(req: Request): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(req.query, "storeCodes")) return null;
  const raw = stringValue(req.query.storeCodes, 5_000);
  const codes = [...new Set(raw.split(",").map(value => value.trim()).filter(Boolean))];
  if (codes.length === 0 || codes.length > 100) return [];
  return codes.every(code => /^[A-Za-z0-9_.-]{2,50}$/.test(code)) ? codes : [];
}

function sqlValues(values: string[]) {
  return sql.join(values.map(value => sql`${value}`), sql`, `);
}

function memberStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  return storeCodes.length === 0
    ? sql`false`
    : inArray(membersTable.storeCode, storeCodes);
}

function transactionStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  if (storeCodes.length === 0) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM members scoped_member
    WHERE scoped_member.id = ${transactionsTable.memberId}
      AND scoped_member.store_code IN (${sqlValues(storeCodes)})
  )`;
}

function withdrawalStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  if (storeCodes.length === 0) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM admin_users scoped_store
    WHERE scoped_store.id = ${withdrawalsTable.storeId}
      AND scoped_store.login_id IN (${sqlValues(storeCodes)})
  )`;
}

function ledgerStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  if (storeCodes.length === 0) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM admin_users scoped_store
    WHERE scoped_store.id = ${moneyLedgerTable.storeId}
      AND scoped_store.login_id IN (${sqlValues(storeCodes)})
  )`;
}

function virtualAccountStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  if (storeCodes.length === 0) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM members scoped_member
    WHERE scoped_member.id = ${virtualAccountIssuancesTable.memberId}
      AND scoped_member.store_code IN (${sqlValues(storeCodes)})
  )`;
}

function activeAccountStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  if (storeCodes.length === 0) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM members scoped_member
    WHERE scoped_member.id = ${virtualAccountsTable.memberId}
      AND scoped_member.store_code IN (${sqlValues(storeCodes)})
  )`;
}

function paymentEventStoreScope(storeCodes: string[] | null) {
  if (storeCodes === null) return undefined;
  if (storeCodes.length === 0) return sql`false`;
  return sql`(
    EXISTS (
      SELECT 1 FROM transactions scoped_tx
      JOIN members scoped_member ON scoped_member.id = scoped_tx.member_id
      WHERE scoped_tx.merchant_id = ${paymentEventsTable.merchantId}
        AND scoped_tx.tracking_number = ${paymentEventsTable.trackingNumber}
        AND scoped_member.store_code IN (${sqlValues(storeCodes)})
    )
    OR EXISTS (
      SELECT 1 FROM withdrawals scoped_withdrawal
      JOIN admin_users scoped_store ON scoped_store.id = scoped_withdrawal.store_id
      WHERE scoped_withdrawal.merchant_id = ${paymentEventsTable.merchantId}
        AND scoped_withdrawal.tracking_number = ${paymentEventsTable.trackingNumber}
        AND scoped_store.login_id IN (${sqlValues(storeCodes)})
    )
  )`;
}

const KPPAY_VIRTUAL_BANK_CODE = "035";
const bankNames: Record<string, string> = { "035": "제주은행" };

function normalizeBirthdate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
    : null;
}

function providerFailure(
  res: Response,
  error: unknown,
  operation: "virtual_account_registration" | "virtual_account_confirmation",
): void {
  if (error instanceof KpPayError) {
    logger.warn({
      operation,
      provider: "kp-pay",
      httpStatus: error.status,
      resultCode: error.resultCode ?? null,
      outcomeUnknown: error.outcomeUnknown,
      providerMessage: error.message.replace(/\d{6,}/g, "[redacted]").slice(0, 200),
    }, "KPPay virtual-account request rejected");
    const status = error.status >= 400 && error.status <= 599 ? error.status : 400;
    res.status(status).json({
      error: error.status >= 500 ? "본인계좌 인증기관 연결에 실패했습니다." : "본인계좌 정보를 확인할 수 없습니다.",
      code: error.resultCode ?? "KP_PAY_ERROR",
    });
    return;
  }
  res.status(502).json({ error: "본인계좌 인증기관 연결에 실패했습니다.", code: "KP_PAY_ERROR" });
}

async function accountForMember(memberId: number) {
  const [account] = await db.select().from(virtualAccountsTable)
    .where(and(eq(virtualAccountsTable.memberId, memberId), eq(virtualAccountsTable.status, "active")))
    .orderBy(desc(virtualAccountsTable.createdAt))
    .limit(1);
  return account ?? null;
}

function registrationResponse(
  issuance: typeof virtualAccountIssuancesTable.$inferSelect,
  account: typeof virtualAccountsTable.$inferSelect | null = null,
) {
  return {
    registrationId: issuance.id,
    memberId: issuance.memberId,
    status: issuance.status,
    expiresAt: issuance.expiresAt?.toISOString() ?? null,
    attemptsRemaining: Math.max(0, 5 - issuance.verificationAttempts),
    virtualAccount: account ? {
      id: account.id,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      status: account.status,
    } : null,
  };
}

async function authenticated(req: Request, res: Response) {
  const context = await requireMerchantApi(req);
  if (!context) {
    res.status(401).json({ error: "Invalid merchant API credentials" });
    return null;
  }
  if (!(await allowRequest("merchant-api", `${req.ip ?? "unknown"}:${context.merchant.id}`, { limit: 600, windowSeconds: 60 }))) {
    res.status(429).json({ error: "Merchant API rate limit exceeded" });
    return null;
  }
  return context;
}

router.get("/external/v1/merchant", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchant = context.merchant;
  res.json({
    id: merchant.id,
    code: merchant.code,
    name: merchant.name,
    status: merchant.status,
    webhookUrl: merchant.webhookUrl,
    allowedIps: merchant.allowedIps ?? [],
    dailyWithdrawalLimit: merchant.dailyWithdrawalLimit,
  });
});

router.get("/external/v1/integration", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchant = context.merchant;
  res.json({
    merchantCode: merchant.code,
    merchantStatus: merchant.status,
    apiAuthenticated: true,
    allowedIpCount: merchant.allowedIps?.length ?? 0,
    webhookConfigured: Boolean(merchant.webhookUrl),
    paymentProviderEnabled: process.env.PAYMENT_PROVIDER_ENABLED === "true",
    checkedAt: new Date().toISOString(),
  });
});

router.post("/external/v1/payment-intents", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const idempotencyKey = req.get("Idempotency-Key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    res.status(400).json({ error: "Valid Idempotency-Key header is required", code: "INVALID_IDEMPOTENCY_KEY" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const merchantOrderId = stringValue(body.merchantOrderId, 100);
  const externalCustomerId = stringValue(body.externalCustomerId, 100) || null;
  const memberId = body.memberId == null ? null : Number(body.memberId);
  const attemptNumber = body.attemptNumber == null ? 1 : Number(body.attemptNumber);
  const amount = typeof body.amount === "string" ? body.amount.trim() : "";
  const currency = stringValue(body.currency ?? "KRW", 3).toUpperCase();
  const description = stringValue(body.description, 200) || null;
  const metadata = body.metadata == null ? {} : body.metadata;
  const requestedExpiresAt = typeof body.expiresAt === "string" ? body.expiresAt : null;
  const expiresAt = requestedExpiresAt
    ? new Date(requestedExpiresAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const metadataText = stableJson(metadata);

  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(merchantOrderId)
    || (!externalCustomerId && memberId == null)
    || (externalCustomerId != null && !/^[A-Za-z0-9._:@-]{1,100}$/.test(externalCustomerId))
    || (memberId != null && (!Number.isSafeInteger(memberId) || memberId <= 0))
    || !Number.isSafeInteger(attemptNumber) || attemptNumber <= 0 || attemptNumber > 999_999
    || !/^[1-9]\d{0,14}$/.test(amount)
    || currency !== "KRW"
    || !metadata || Array.isArray(metadata) || typeof metadata !== "object"
    || metadataText.length > 8_192
    || Number.isNaN(expiresAt.getTime())
    || expiresAt.getTime() < Date.now() + 5 * 60 * 1_000
    || expiresAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1_000) {
    res.status(400).json({ error: "Invalid payment intent", code: "INVALID_PAYMENT_INTENT" });
    return;
  }

  const requestHash = crypto.createHash("sha256").update(stableJson({
    merchantOrderId, externalCustomerId, memberId, attemptNumber, amount, currency,
    description, metadata, expiresAt: requestedExpiresAt ? expiresAt.toISOString() : null,
  })).digest("hex");
  const [idempotent] = await db.select().from(paymentIntentsTable).where(and(
    eq(paymentIntentsTable.merchantId, context.merchant.id),
    eq(paymentIntentsTable.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (idempotent) {
    if (idempotent.requestHash !== requestHash) {
      res.status(409).json({ error: "Idempotency-Key was used with different input", code: "IDEMPOTENCY_CONFLICT" });
      return;
    }
    res.json(paymentIntentResponse(idempotent, await intentAccount(idempotent)));
    return;
  }

  let account: typeof virtualAccountsTable.$inferSelect | null = null;
  if (memberId != null) {
    const [member] = await db.select().from(membersTable).where(and(
      eq(membersTable.id, memberId),
      eq(membersTable.merchantId, context.merchant.id),
    )).limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found", code: "MEMBER_NOT_FOUND" });
      return;
    }
    account = await accountForMember(member.id);
    if (!member.isActive || !member.isVerified || !account || account.merchantId !== context.merchant.id) account = null;
  }

  const publicId = `pi_${crypto.randomUUID().replace(/-/g, "")}`;
  const providerTrackingNumber = createPaymentIntentTrackId({
    merchantId: context.merchant.id,
    merchantOrderId,
    attemptNumber,
  });
  try {
    const intent = await db.transaction(async (tx) => {
      const [created] = await tx.insert(paymentIntentsTable).values({
        publicId,
        merchantId: context.merchant.id,
        merchantOrderId,
        attemptNumber,
        externalCustomerId,
        memberId,
        virtualAccountId: account?.id ?? null,
        amount,
        currency,
        status: account ? "awaiting_deposit" : "requires_member",
        idempotencyKey,
        requestHash,
        providerTrackingNumber,
        description,
        metadata,
        expiresAt,
      }).returning();
      await tx.insert(paymentIntentEventsTable).values({
        paymentIntentId: created.id,
        eventType: "payment_intent.created",
        source: "merchant_api",
        sourceEventId: `create:${created.publicId}`,
        payload: { status: created.status },
      });
      if (created.status === "awaiting_deposit") {
        await tx.insert(paymentIntentEventsTable).values({
          paymentIntentId: created.id,
          eventType: "payment_intent.awaiting_deposit",
          source: "merchant_api",
          sourceEventId: `awaiting-deposit:${created.publicId}`,
          payload: { status: created.status, memberId: created.memberId, virtualAccountId: created.virtualAccountId },
        });
      }
      return created;
    });
    res.status(201).json(paymentIntentResponse(intent, account));
  } catch {
    const [replayed] = await db.select().from(paymentIntentsTable).where(and(
      eq(paymentIntentsTable.merchantId, context.merchant.id),
      eq(paymentIntentsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (replayed?.requestHash === requestHash) {
      res.json(paymentIntentResponse(replayed, await intentAccount(replayed)));
      return;
    }
    const [orderConflict] = await db.select().from(paymentIntentsTable).where(and(
      eq(paymentIntentsTable.merchantId, context.merchant.id),
      eq(paymentIntentsTable.merchantOrderId, merchantOrderId),
      eq(paymentIntentsTable.attemptNumber, attemptNumber),
    )).limit(1);
    if (orderConflict) {
      res.status(409).json({ error: "merchantOrderId already exists", code: "MERCHANT_ORDER_EXISTS" });
      return;
    }
    throw new Error("PAYMENT_INTENT_CREATE_FAILED");
  }
});

router.get("/external/v1/payment-intents/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = stringValue(req.params.id, 80);
  const [intent] = await db.select().from(paymentIntentsTable).where(and(
    eq(paymentIntentsTable.publicId, id),
    eq(paymentIntentsTable.merchantId, context.merchant.id),
  )).limit(1);
  if (!intent) {
    res.status(404).json({ error: "Payment intent not found", code: "PAYMENT_INTENT_NOT_FOUND" });
    return;
  }
  res.json(paymentIntentResponse(intent, await intentAccount(intent)));
});

router.get("/external/v1/payment-intents", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchantOrderId = stringValue(req.query.merchantOrderId, 100);
  const rawAttemptNumber = req.query.attemptNumber;
  const attemptNumber = rawAttemptNumber == null ? null : Number(rawAttemptNumber);
  if (!merchantOrderId) {
    res.status(400).json({ error: "merchantOrderId is required", code: "INVALID_MERCHANT_ORDER_ID" });
    return;
  }
  if (attemptNumber != null && (!Number.isSafeInteger(attemptNumber) || attemptNumber <= 0)) {
    res.status(400).json({ error: "Invalid attemptNumber", code: "INVALID_ATTEMPT_NUMBER" });
    return;
  }
  const [intent] = await db.select().from(paymentIntentsTable).where(and(
    eq(paymentIntentsTable.merchantId, context.merchant.id),
    eq(paymentIntentsTable.merchantOrderId, merchantOrderId),
    ...(attemptNumber == null ? [] : [eq(paymentIntentsTable.attemptNumber, attemptNumber)]),
  )).orderBy(desc(paymentIntentsTable.attemptNumber)).limit(1);
  if (!intent) {
    res.status(404).json({ error: "Payment intent not found", code: "PAYMENT_INTENT_NOT_FOUND" });
    return;
  }
  res.json(paymentIntentResponse(intent, await intentAccount(intent)));
});

router.post("/external/v1/payment-intents/:id/member", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = stringValue(req.params.id, 80);
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const memberId = Number(body.memberId);
  if (!/^pi_[a-f0-9]{32}$/.test(id)
    || Object.keys(body).some((key) => key !== "memberId")
    || !Number.isSafeInteger(memberId) || memberId <= 0) {
    res.status(400).json({ error: "Valid memberId is required", code: "INVALID_MEMBER_ID" });
    return;
  }

  const [intent] = await db.select().from(paymentIntentsTable).where(and(
    eq(paymentIntentsTable.publicId, id),
    eq(paymentIntentsTable.merchantId, context.merchant.id),
  )).limit(1);
  if (!intent) {
    res.status(404).json({ error: "Payment intent not found", code: "PAYMENT_INTENT_NOT_FOUND" });
    return;
  }

  const [member] = await db.select().from(membersTable).where(and(
    eq(membersTable.id, memberId),
    eq(membersTable.merchantId, context.merchant.id),
    eq(membersTable.isActive, true),
    eq(membersTable.isVerified, true),
  )).limit(1);
  if (!member) {
    res.status(409).json({ error: "Member is not active and verified", code: "MEMBER_NOT_READY" });
    return;
  }
  const account = await accountForMember(member.id);
  if (!account || account.merchantId !== context.merchant.id || account.status !== "active") {
    res.status(409).json({ error: "Member has no active virtual account", code: "VIRTUAL_ACCOUNT_NOT_READY" });
    return;
  }

  if (isPaymentIntentMemberReplay(intent.status, intent.memberId, memberId)) {
    res.json(paymentIntentResponse(intent, await intentAccount(intent)));
    return;
  }
  if (intent.status !== "requires_member") {
    res.status(409).json({ error: "Payment intent member cannot be changed", code: "PAYMENT_INTENT_MEMBER_CONFLICT" });
    return;
  }

  const attached = await db.transaction(async (tx) => {
    const [changed] = await tx.update(paymentIntentsTable).set({
      memberId,
      virtualAccountId: account.id,
      status: "awaiting_deposit",
      updatedAt: new Date(),
      version: sql`${paymentIntentsTable.version} + 1`,
    }).where(and(
      eq(paymentIntentsTable.id, intent.id),
      eq(paymentIntentsTable.status, "requires_member"),
    )).returning();
    if (!changed) return null;
    await tx.insert(paymentIntentEventsTable).values({
      paymentIntentId: changed.id,
        eventType: "payment_intent.awaiting_deposit",
      source: "merchant_api",
      sourceEventId: `attach:${changed.publicId}`,
      payload: {
        fromStatus: "requires_member",
        status: changed.status,
        memberId,
        virtualAccountId: account.id,
      },
    });
    return changed;
  });
  if (attached) {
    res.json(paymentIntentResponse(attached, account));
    return;
  }

  const [concurrent] = await db.select().from(paymentIntentsTable).where(and(
    eq(paymentIntentsTable.id, intent.id),
    eq(paymentIntentsTable.merchantId, context.merchant.id),
  )).limit(1);
  if (concurrent && isPaymentIntentMemberReplay(concurrent.status, concurrent.memberId, memberId)) {
    res.json(paymentIntentResponse(concurrent, await intentAccount(concurrent)));
    return;
  }
  res.status(409).json({ error: "Payment intent state changed", code: "PAYMENT_INTENT_STATE_CONFLICT" });
});

router.post("/external/v1/payment-intents/:id/cancel", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = stringValue(req.params.id, 80);
  const [existing] = await db.select().from(paymentIntentsTable).where(and(
    eq(paymentIntentsTable.publicId, id),
    eq(paymentIntentsTable.merchantId, context.merchant.id),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Payment intent not found", code: "PAYMENT_INTENT_NOT_FOUND" });
    return;
  }
  if (existing.status === "cancelled") {
    res.json(paymentIntentResponse(existing, await intentAccount(existing)));
    return;
  }
  if (!["requires_member", "awaiting_deposit"].includes(existing.status)) {
    res.status(409).json({ error: "Payment intent cannot be cancelled", code: "INVALID_PAYMENT_INTENT_STATE" });
    return;
  }
  const cancelled = await db.transaction(async (tx) => {
    const [changed] = await tx.update(paymentIntentsTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
      version: sql`${paymentIntentsTable.version} + 1`,
    }).where(and(
      eq(paymentIntentsTable.id, existing.id),
      inArray(paymentIntentsTable.status, ["requires_member", "awaiting_deposit"]),
    )).returning();
    if (!changed) return null;
    await tx.insert(paymentIntentEventsTable).values({
      paymentIntentId: changed.id,
      eventType: "payment_intent.cancelled",
      source: "merchant_api",
      sourceEventId: `cancel:${changed.publicId}`,
      payload: { status: changed.status },
    }).onConflictDoNothing();
    return changed;
  });
  if (!cancelled) {
    res.status(409).json({ error: "Payment intent state changed", code: "PAYMENT_INTENT_STATE_CONFLICT" });
    return;
  }
  res.json(paymentIntentResponse(cancelled, await intentAccount(cancelled)));
});

router.get("/external/v1/fees", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const [fee] = await db.select().from(merchantFeeConfigsTable)
    .where(eq(merchantFeeConfigsTable.merchantId, context.merchant.id))
    .limit(1);
  res.json(fee ? {
    configured: true,
    depositFee: fee.depositFee,
    withdrawalFee: fee.withdrawalFee,
    usageFeeRate: Number(fee.usageFeeRate),
    effectiveFrom: fee.effectiveFrom.toISOString(),
    updatedAt: fee.updatedAt.toISOString(),
  } : {
    configured: false,
    depositFee: null,
    withdrawalFee: null,
    usageFeeRate: null,
    effectiveFrom: null,
    updatedAt: null,
  });
});

router.get("/external/v1/balance", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const storeScope = ledgerStoreScope(storeCodesValue(req));
  const balanceScope = and(
    eq(moneyLedgerTable.merchantId, context.merchant.id),
    ...(storeScope ? [storeScope] : []),
  );
  const [row] = await db.select({
    availableBalance: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'credit' then ${moneyLedgerTable.amount} else -${moneyLedgerTable.amount} end), 0)`,
    creditTotal: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'credit' then ${moneyLedgerTable.amount} else 0 end), 0)`,
    debitTotal: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'debit' then ${moneyLedgerTable.amount} else 0 end), 0)`,
  }).from(moneyLedgerTable).where(balanceScope);
  res.json({
    currency: "KRW",
    availableBalance: Number(row.availableBalance),
    creditTotal: Number(row.creditTotal),
    debitTotal: Number(row.debitTotal),
    calculatedAt: new Date().toISOString(),
  });
});

router.get("/external/v1/virtual-accounts", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const offset = (page - 1) * limit;
  const status = stringValue(req.query.status, 40);
  const conditions = [eq(virtualAccountIssuancesTable.merchantId, context.merchant.id)];
  const storeScope = virtualAccountStoreScope(storeCodesValue(req));
  if (storeScope) conditions.push(storeScope);
  if (status) conditions.push(eq(virtualAccountIssuancesTable.status, status));
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db.select().from(virtualAccountIssuancesTable).where(scope)
      .orderBy(desc(virtualAccountIssuancesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(virtualAccountIssuancesTable).where(scope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
    items: items.map((item) => ({
      id: item.id,
      memberId: item.memberId,
      trackingNumber: item.trackingNumber,
      bankCode: item.virtualBankCode,
      accountNumber: item.virtualAccountNumber,
      status: item.status,
      expiresAt: item.expiresAt?.toISOString() ?? null,
      verifiedAt: item.verifiedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  });
});

/**
 * Merchant-portal read model. Every query is anchored to the merchant derived
 * from the API key; client supplied merchant IDs are deliberately not accepted.
 */
router.get("/external/v1/overview", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchantId = context.merchant.id;
  const storeCodes = storeCodesValue(req);
  const memberStore = memberStoreScope(storeCodes);
  const transactionStore = transactionStoreScope(storeCodes);
  const withdrawalStore = withdrawalStoreScope(storeCodes);
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const [[memberCount], [transactionCount], [pendingWithdrawals], [todayDeposits]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(membersTable)
      .where(and(eq(membersTable.merchantId, merchantId), ...(memberStore ? [memberStore] : []))),
    db.select({ count: sql<number>`count(*)` }).from(transactionsTable)
      .where(and(eq(transactionsTable.merchantId, merchantId), ...(transactionStore ? [transactionStore] : []))),
    db.select({ count: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)` })
      .from(withdrawalsTable).where(and(
        eq(withdrawalsTable.merchantId, merchantId),
        eq(withdrawalsTable.approvalStatus, "pending"),
        ...(withdrawalStore ? [withdrawalStore] : []),
      )),
    db.select({ amount: sql<number>`coalesce(sum(${transactionsTable.amount}), 0)` })
      .from(transactionsTable).where(and(
        eq(transactionsTable.merchantId, merchantId),
        eq(transactionsTable.type, "deposit"),
        gte(transactionsTable.createdAt, since),
        ...(transactionStore ? [transactionStore] : []),
      )),
  ]);
  res.json({
    members: Number(memberCount.count),
    transactions: Number(transactionCount.count),
    pendingWithdrawals: { count: Number(pendingWithdrawals.count), amount: Number(pendingWithdrawals.amount) },
    todayDeposits: Number(todayDeposits.amount),
  });
});

router.get("/external/v1/statistics/overview", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchantId = context.merchant.id;
  const storeCodes = storeCodesValue(req);
  const memberStore = memberStoreScope(storeCodes);
  const transactionStore = transactionStoreScope(storeCodes);
  const withdrawalStore = withdrawalStoreScope(storeCodes);
  const accountStore = activeAccountStoreScope(storeCodes);
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const txWhere = (since: Date, type?: string) => and(
    eq(transactionsTable.merchantId, merchantId),
    eq(transactionsTable.status, "success"),
    ...(type ? [eq(transactionsTable.type, type)] : []),
    gte(transactionsTable.createdAt, since),
    ...(transactionStore ? [transactionStore] : []),
  );
  const wdWhere = (since: Date) => and(
    eq(withdrawalsTable.merchantId, merchantId),
    sql`${withdrawalsTable.approvalStatus} != 'rejected'`,
    gte(withdrawalsTable.createdAt, since),
    ...(withdrawalStore ? [withdrawalStore] : []),
  );
  const [
    [todayDeposit],
    [todayWithdrawal],
    [todayFee],
    [monthDeposit],
    [monthWithdrawal],
    [totalMembers],
    [activeVirtualAccounts],
    [pendingWithdrawals],
  ] = await Promise.all([
    db.select({ value: sql<number>`coalesce(sum(${transactionsTable.originalAmount}), 0)` })
      .from(transactionsTable).where(txWhere(todayStart, "deposit")),
    db.select({ value: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)` })
      .from(withdrawalsTable).where(wdWhere(todayStart)),
    db.select({ value: sql<number>`coalesce(sum(${transactionsTable.fee}), 0)` })
      .from(transactionsTable).where(txWhere(todayStart)),
    db.select({ value: sql<number>`coalesce(sum(${transactionsTable.originalAmount}), 0)` })
      .from(transactionsTable).where(txWhere(monthStart, "deposit")),
    db.select({ value: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)` })
      .from(withdrawalsTable).where(wdWhere(monthStart)),
    db.select({ value: sql<number>`count(*)` }).from(membersTable).where(and(
      eq(membersTable.merchantId, merchantId),
      ...(memberStore ? [memberStore] : []),
    )),
    db.select({ value: sql<number>`count(*)` }).from(virtualAccountsTable).where(and(
      eq(virtualAccountsTable.merchantId, merchantId),
      eq(virtualAccountsTable.status, "active"),
      ...(accountStore ? [accountStore] : []),
    )),
    db.select({ value: sql<number>`count(*)` }).from(withdrawalsTable).where(and(
      eq(withdrawalsTable.merchantId, merchantId),
      eq(withdrawalsTable.approvalStatus, "pending"),
      ...(withdrawalStore ? [withdrawalStore] : []),
    )),
  ]);
  res.json({
    todayDeposit: Number(todayDeposit.value),
    todayWithdrawal: Number(todayWithdrawal.value),
    todayFee: Number(todayFee.value),
    monthDeposit: Number(monthDeposit.value),
    monthWithdrawal: Number(monthWithdrawal.value),
    totalMembers: Number(totalMembers.value),
    activeVirtualAccounts: Number(activeVirtualAccounts.value),
    pendingWithdrawals: Number(pendingWithdrawals.value),
  });
});

router.get("/external/v1/statistics/daily", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const startDate = dateValue(req.query.startDate)
    ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = dateValue(req.query.endDate, true) ?? new Date();
  if (endDate.getTime() - startDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: "통계 조회 기간은 최대 366일입니다." });
    return;
  }
  const transactionStore = transactionStoreScope(storeCodesValue(req));
  const withdrawalStore = withdrawalStoreScope(storeCodesValue(req));
  const txDate = sql<string>`to_char(timezone('Asia/Seoul', ${transactionsTable.createdAt}), 'YYYY-MM-DD')`;
  const wdDate = sql<string>`to_char(timezone('Asia/Seoul', ${withdrawalsTable.createdAt}), 'YYYY-MM-DD')`;
  const [transactionRows, withdrawalRows] = await Promise.all([
    db.select({
      date: txDate,
      depositCount: sql<number>`count(*) filter (where ${transactionsTable.type} = 'deposit')`,
      depositAmount: sql<number>`coalesce(sum(${transactionsTable.originalAmount}) filter (where ${transactionsTable.type} = 'deposit'), 0)`,
      netDepositAmount: sql<number>`coalesce(sum(${transactionsTable.amount}) filter (where ${transactionsTable.type} = 'deposit'), 0)`,
      feeAmount: sql<number>`coalesce(sum(${transactionsTable.fee}), 0)`,
    }).from(transactionsTable).where(and(
      eq(transactionsTable.merchantId, context.merchant.id),
      eq(transactionsTable.status, "success"),
      gte(transactionsTable.createdAt, startDate),
      lte(transactionsTable.createdAt, endDate),
      ...(transactionStore ? [transactionStore] : []),
    )).groupBy(txDate),
    db.select({
      date: wdDate,
      withdrawalCount: sql<number>`count(*)`,
      withdrawalAmount: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
    }).from(withdrawalsTable).where(and(
      eq(withdrawalsTable.merchantId, context.merchant.id),
      sql`${withdrawalsTable.approvalStatus} != 'rejected'`,
      gte(withdrawalsTable.createdAt, startDate),
      lte(withdrawalsTable.createdAt, endDate),
      ...(withdrawalStore ? [withdrawalStore] : []),
    )).groupBy(wdDate),
  ]);
  const byDate = new Map<string, {
    date: string;
    depositCount: number;
    depositAmount: number;
    netDepositAmount: number;
    withdrawalCount: number;
    withdrawalAmount: number;
    feeAmount: number;
  }>();
  for (const row of transactionRows) {
    byDate.set(row.date, {
      date: row.date,
      depositCount: Number(row.depositCount),
      depositAmount: Number(row.depositAmount),
      netDepositAmount: Number(row.netDepositAmount),
      withdrawalCount: 0,
      withdrawalAmount: 0,
      feeAmount: Number(row.feeAmount),
    });
  }
  for (const row of withdrawalRows) {
    const item = byDate.get(row.date) ?? {
      date: row.date,
      depositCount: 0,
      depositAmount: 0,
      netDepositAmount: 0,
      withdrawalCount: 0,
      withdrawalAmount: 0,
      feeAmount: 0,
    };
    item.withdrawalCount = Number(row.withdrawalCount);
    item.withdrawalAmount = Number(row.withdrawalAmount);
    byDate.set(row.date, item);
  }
  res.json([...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(item => ({
      date: item.date,
      depositCount: item.depositCount,
      depositAmount: item.depositAmount,
      withdrawalCount: item.withdrawalCount,
      withdrawalAmount: item.withdrawalAmount,
      feeAmount: item.feeAmount,
      netAmount: item.netDepositAmount - item.withdrawalAmount,
    })));
});

router.get("/external/v1/members", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const offset = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conditions = [eq(membersTable.merchantId, context.merchant.id)];
  const storeScope = memberStoreScope(storeCodesValue(req));
  if (storeScope) conditions.push(storeScope);
  if (search) conditions.push(
    sql`(${membersTable.name} ilike ${`%${search}%`} or ${membersTable.loginId} ilike ${`%${search}%`} or ${membersTable.phone} ilike ${`%${search}%`})`,
  );
  const scope = and(...conditions);
  const [members, [{ count }]] = await Promise.all([
    db.select().from(membersTable).where(scope).orderBy(desc(membersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(membersTable).where(scope),
  ]);
  const ids = members.map((member) => member.id);
  const accounts = ids.length === 0 ? [] : await db.select().from(virtualAccountsTable)
    .where(and(inArray(virtualAccountsTable.memberId, ids), eq(virtualAccountsTable.status, "active")));
  const accountByMember = new Map(accounts.map((account) => [account.memberId, account]));
  res.json({
    page, limit, total: Number(count),
    items: members.map((member) => {
      const account = accountByMember.get(member.id);
      return {
        id: member.id, loginId: member.loginId, name: member.name, phone: member.phone, email: member.email ?? null,
        birthdate: member.birthdate ?? null, isActive: member.isActive, isVerified: member.isVerified,
        virtualAccount: account ? { bankName: account.bankName, accountNumber: account.accountNumber, status: account.status } : null,
        createdAt: member.createdAt.toISOString(),
      };
    }),
  });
});

/**
 * Starts the production member onboarding flow. KPPay sends KRW 1 to the
 * member's own account and the TodoPay member remains inactive until the
 * four-digit code is confirmed.
 */
router.post("/external/v1/member-registrations", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  if (!(await allowRequest("merchant-member-registration", `${context.merchant.id}:${req.ip ?? "unknown"}`, { limit: 10, windowSeconds: 60 * 60 }))) {
    res.status(429).json({ error: "가입 인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
    return;
  }
  if (process.env.PAYMENT_PROVIDER_ENABLED !== "true") {
    res.status(503).json({ error: "실명 인증 서비스를 사용할 수 없습니다.", code: "PROVIDER_DISABLED" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const registrationKey = stringValue(body.registrationKey, 64);
  const loginId = stringValue(body.loginId, 50);
  const password = typeof body.password === "string" ? body.password : "";
  const name = stringValue(body.name, 50);
  const phone = stringValue(body.phone, 20).replace(/\D/g, "");
  const email = stringValue(body.email, 200);
  const birthdate = normalizeBirthdate(body.birthdate);
  const withdrawBankCode = stringValue(body.withdrawBankCode, 3);
  const withdrawAccount = stringValue(body.withdrawAccount, 30).replace(/\D/g, "");

  if (!/^[0-9a-f-]{36}$/i.test(registrationKey)
    || !/^[A-Za-z0-9_.-]{4,50}$/.test(loginId)
    || password.length < 8 || password.length > 72
    || !name || !/^01[016789]\d{7,8}$/.test(phone)
    || !birthdate || !/^\d{3}$/.test(withdrawBankCode)
    || !/^\d{6,20}$/.test(withdrawAccount)) {
    res.status(400).json({ error: "회원 또는 본인계좌 정보를 다시 확인해 주세요.", code: "INVALID_REGISTRATION" });
    return;
  }

  const [existingIssuance] = await db.select().from(virtualAccountIssuancesTable)
    .where(and(
      eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
      eq(virtualAccountIssuancesTable.idempotencyKey, registrationKey),
    )).limit(1);
  if (existingIssuance) {
    const account = existingIssuance.status === "issued" ? await accountForMember(existingIssuance.memberId) : null;
    res.status(existingIssuance.status === "failed" ? 409 : 200).json(registrationResponse(existingIssuance, account));
    return;
  }

  const [duplicate] = await db.select().from(membersTable)
    .where(eq(membersTable.loginId, loginId)).limit(1);
  if (duplicate) {
    res.status(409).json({ error: "이미 사용 중인 아이디입니다.", code: "LOGIN_ID_EXISTS" });
    return;
  }
  const [ledgerStore] = await db.select({
    id: adminUsersTable.id,
    loginId: adminUsersTable.loginId,
  }).from(adminUsersTable).where(and(
    eq(adminUsersTable.merchantId, context.merchant.id),
    eq(adminUsersTable.role, "store"),
    eq(adminUsersTable.isActive, true),
  )).orderBy(adminUsersTable.id).limit(1);
  if (!ledgerStore) {
    res.status(409).json({ error: "가맹점 원장 매장이 설정되지 않았습니다.", code: "LEDGER_STORE_MISSING" });
    return;
  }
  const merchantId = process.env.KP_PAY_MERCHANT_ID?.trim() ?? "";
  if (!merchantId) {
    res.status(503).json({ error: "실명 인증 설정이 완료되지 않았습니다.", code: "PROVIDER_CONFIG_MISSING" });
    return;
  }

  let member: typeof membersTable.$inferSelect | undefined;
  let issuance: typeof virtualAccountIssuancesTable.$inferSelect | undefined;
  try {
    const available = await new KpPayClient().availableVirtualAccounts([KPPAY_VIRTUAL_BANK_CODE]);
    const candidate = available.vact.vacts?.find((item) => item.bankCd === KPPAY_VIRTUAL_BANK_CODE);
    if (!candidate) {
      res.status(409).json({ error: "현재 발급 가능한 가상계좌가 없습니다.", code: "NO_VIRTUAL_ACCOUNT" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const trackingNumber = `VA-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    [member] = await db.insert(membersTable).values({
      loginId,
      passwordHash,
      name,
      phone,
      email: email || null,
      birthdate,
      merchantId: context.merchant.id,
      storeId: ledgerStore.id,
      storeCode: ledgerStore.loginId,
      isVerified: false,
      isActive: false,
    }).returning();
    [issuance] = await db.insert(virtualAccountIssuancesTable).values({
      merchantId: context.merchant.id,
      memberId: member.id,
      idempotencyKey: registrationKey,
      trackingNumber,
      virtualAccountNumber: candidate.account,
      virtualBankCode: KPPAY_VIRTUAL_BANK_CODE,
      status: "requesting",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }).returning();

    const registration = await new KpPayClient().requestVirtualAccountRegistration({
      mchtId: merchantId,
      account: candidate.account,
      withdrawBankCd: withdrawBankCode,
      withdrawAccount,
      identity: birthdate.replace(/\D/g, "").slice(2),
      phoneNo: phone,
      name,
      holderName: context.merchant.name.slice(0, 20),
      trackId: trackingNumber,
      udf1: String(member.id),
      udf2: String(context.merchant.id),
    });
    if (!registration.vact.authNo) throw new KpPayError("KPPay verification ID missing", 502);

    const [pending] = await db.update(virtualAccountIssuancesTable).set({
      status: "awaiting_verification",
      providerAuthNo: registration.vact.authNo,
      providerIssueId: registration.vact.issueId ?? null,
      updatedAt: new Date(),
    }).where(eq(virtualAccountIssuancesTable.id, issuance.id)).returning();
    res.status(201).json(registrationResponse(pending));
  } catch (error) {
    if (issuance) {
      await db.delete(virtualAccountIssuancesTable).where(eq(virtualAccountIssuancesTable.id, issuance.id));
    }
    if (member) {
      await db.delete(membersTable).where(and(
        eq(membersTable.id, member.id),
        eq(membersTable.isActive, false),
      ));
    }
    providerFailure(res, error, "virtual_account_registration");
  }
});

router.get("/external/v1/member-registrations/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "올바르지 않은 가입 인증 번호입니다." });
    return;
  }
  const [issuance] = await db.select().from(virtualAccountIssuancesTable).where(and(
    eq(virtualAccountIssuancesTable.id, id),
    eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
  )).limit(1);
  if (!issuance) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (issuance.status === "awaiting_verification" && issuance.expiresAt && issuance.expiresAt < new Date()) {
    const [expired] = await db.update(virtualAccountIssuancesTable).set({
      status: "expired",
      updatedAt: new Date(),
    }).where(eq(virtualAccountIssuancesTable.id, issuance.id)).returning();
    res.json(registrationResponse(expired));
    return;
  }
  const account = issuance.status === "issued" ? await accountForMember(issuance.memberId) : null;
  res.json(registrationResponse(issuance, account));
});

router.post("/external/v1/member-registrations/:id/confirm", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  const code = stringValue(req.body?.code, 4);
  if (!Number.isSafeInteger(id) || id <= 0 || !/^\d{4}$/.test(code)) {
    res.status(400).json({ error: "1원 입금자명의 숫자 4자리를 입력해 주세요.", code: "INVALID_CODE" });
    return;
  }
  if (!(await allowRequest("merchant-member-confirm", `${context.merchant.id}:${id}`, { limit: 10, windowSeconds: 10 * 60 }))) {
    res.status(429).json({ error: "인증번호 확인 요청이 너무 많습니다.", code: "TOO_MANY_ATTEMPTS" });
    return;
  }
  const [issuance] = await db.select().from(virtualAccountIssuancesTable).where(and(
    eq(virtualAccountIssuancesTable.id, id),
    eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
  )).limit(1);
  if (!issuance) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (issuance.status === "issued") {
    res.json(registrationResponse(issuance, await accountForMember(issuance.memberId)));
    return;
  }
  if (issuance.verificationAttempts >= 5) {
    res.status(409).json({ error: "인증번호 입력 횟수를 초과했습니다. 가입을 다시 시작해 주세요.", code: "TOO_MANY_ATTEMPTS" });
    return;
  }
  if (issuance.status !== "awaiting_verification" || !issuance.providerAuthNo
    || !issuance.expiresAt || issuance.expiresAt < new Date()) {
    if (issuance.status === "awaiting_verification") {
      await db.update(virtualAccountIssuancesTable).set({ status: "expired", updatedAt: new Date() })
        .where(eq(virtualAccountIssuancesTable.id, issuance.id));
    }
    res.status(409).json({ error: "인증 유효시간이 만료되었습니다. 가입을 다시 시작해 주세요.", code: "REGISTRATION_EXPIRED" });
    return;
  }

  try {
    const confirmation = await new KpPayClient().confirmVirtualAccountRegistration({
      mchtId: process.env.KP_PAY_MERCHANT_ID ?? "",
      authNo: issuance.providerAuthNo,
      oneCertiInNo: code,
    });
    await db.transaction(async (tx) => {
      await tx.update(virtualAccountsTable).set({ status: "revoked" }).where(and(
        eq(virtualAccountsTable.memberId, issuance.memberId),
        eq(virtualAccountsTable.status, "active"),
      ));
      const [insertedAccount] = await tx.insert(virtualAccountsTable).values({
        accountNumber: confirmation.vact.account,
        bankName: bankNames[confirmation.vact.bankCd ?? issuance.virtualBankCode]
          ?? confirmation.vact.bankCd ?? issuance.virtualBankCode,
        status: "active",
        memberId: issuance.memberId,
        merchantId: context.merchant.id,
      }).onConflictDoNothing({ target: virtualAccountsTable.accountNumber }).returning();
      if (!insertedAccount) {
        const [ownedAccount] = await tx.select({ id: virtualAccountsTable.id })
          .from(virtualAccountsTable)
          .where(and(
            eq(virtualAccountsTable.accountNumber, confirmation.vact.account),
            eq(virtualAccountsTable.memberId, issuance.memberId),
            eq(virtualAccountsTable.merchantId, context.merchant.id),
          )).limit(1);
        if (!ownedAccount) throw new Error("KPPay virtual account is already assigned");
      }
      await tx.update(virtualAccountIssuancesTable).set({
        status: "issued",
        providerIssueId: confirmation.vact.issueId,
        verifiedAt: new Date(),
        updatedAt: new Date(),
        lastErrorCode: null,
      }).where(eq(virtualAccountIssuancesTable.id, issuance.id));
      await tx.update(membersTable).set({ isVerified: true, isActive: true })
        .where(and(eq(membersTable.id, issuance.memberId), eq(membersTable.merchantId, context.merchant.id)));
    });
    const [completed] = await db.select().from(virtualAccountIssuancesTable)
      .where(eq(virtualAccountIssuancesTable.id, issuance.id));
    res.json(registrationResponse(completed, await accountForMember(issuance.memberId)));
  } catch (error) {
    if (error instanceof KpPayError && error.status < 500) {
      const attempts = issuance.verificationAttempts + 1;
      await db.update(virtualAccountIssuancesTable).set({
        verificationAttempts: attempts,
        lastErrorCode: error.resultCode ?? "INVALID_CODE",
        updatedAt: new Date(),
        ...(attempts >= 5 ? { status: "failed" } : {}),
      }).where(eq(virtualAccountIssuancesTable.id, issuance.id));
      res.status(400).json({
        error: attempts >= 5
          ? "인증번호 입력 횟수를 초과했습니다. 가입을 다시 시작해 주세요."
          : "1원 입금자명의 숫자 4자리가 일치하지 않습니다.",
        code: attempts >= 5 ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE",
        attemptsRemaining: Math.max(0, 5 - attempts),
      });
      return;
    }
    providerFailure(res, error, "virtual_account_confirmation");
  }
});

router.post("/external/v1/member-registrations/:id/cancel", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "올바르지 않은 가입 인증 번호입니다." });
    return;
  }
  const [issuance] = await db.select().from(virtualAccountIssuancesTable).where(and(
    eq(virtualAccountIssuancesTable.id, id),
    eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
  )).limit(1);
  if (!issuance) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (issuance.status === "issued") {
    res.status(409).json({ error: "이미 완료된 가입은 취소할 수 없습니다." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(virtualAccountIssuancesTable).set({
      status: "cancelled",
      updatedAt: new Date(),
    }).where(eq(virtualAccountIssuancesTable.id, issuance.id));
    await tx.delete(membersTable).where(and(
      eq(membersTable.id, issuance.memberId),
      eq(membersTable.merchantId, context.merchant.id),
      eq(membersTable.isActive, false),
    ));
  });
  res.status(204).end();
});

router.get("/external/v1/members/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "올바르지 않은 회원 번호입니다." });
    return;
  }
  const storeScope = memberStoreScope(storeCodesValue(req));
  const [member] = await db.select().from(membersTable).where(and(
    eq(membersTable.id, id),
    eq(membersTable.merchantId, context.merchant.id),
    ...(storeScope ? [storeScope] : []),
  )).limit(1);
  if (!member) {
    res.status(404).json({ error: "회원을 찾을 수 없습니다." });
    return;
  }
  const account = await accountForMember(member.id);
  res.json({
    id: member.id,
    loginId: member.loginId,
    name: member.name,
    phone: member.phone,
    birthdate: member.birthdate ?? null,
    isActive: member.isActive,
    isVerified: member.isVerified,
    virtualAccount: account ? {
      id: account.id,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      status: account.status,
    } : null,
    createdAt: member.createdAt.toISOString(),
  });
});

/** Legacy direct creation is disabled because it bypasses 1-won verification. */
router.post("/external/v1/members", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  res.status(410).json({
    error: "정식 1원 인증 가입 API를 사용해 주세요.",
    code: "MEMBER_REGISTRATION_REQUIRED",
  });
  return;
  /*
  if (!(await allowRequest("merchant-member-create", `${context.merchant.id}:${req.ip ?? "unknown"}`, { limit: 20, windowSeconds: 60 * 60 }))) {
    res.status(429).json({ error: "Too many member creation requests" }); return;
  }
  const body = req.body as Record<string, unknown>;
  const loginId = typeof body.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(loginId) || password.length < 8 || !name || !phone) {
    res.status(400).json({ error: "Invalid member information" }); return;
  }
  const [duplicate] = await db.select({ id: membersTable.id }).from(membersTable).where(eq(membersTable.loginId, loginId)).limit(1);
  if (duplicate) { res.status(409).json({ error: "Member login ID already exists" }); return; }
  const [ledgerStore] = await db.select({
    id: adminUsersTable.id,
    loginId: adminUsersTable.loginId,
  }).from(adminUsersTable).where(and(
    eq(adminUsersTable.merchantId, context.merchant.id),
    eq(adminUsersTable.role, "store"),
    eq(adminUsersTable.isActive, true),
  )).orderBy(adminUsersTable.id).limit(1);
  if (!ledgerStore) {
    res.status(409).json({ error: "Merchant ledger store is not configured" }); return;
  }
  const [member] = await db.insert(membersTable).values({
    loginId, passwordHash: await hashPassword(password), name, phone,
    email: email || null,
    merchantId: context.merchant.id,
    storeId: ledgerStore.id,
    storeCode: ledgerStore.loginId,
    isVerified: true,
    isActive: true,
  }).returning();
  res.status(201).json({ id: member.id, loginId: member.loginId, name: member.name, phone: member.phone, email: member.email ?? null, isActive: member.isActive, virtualAccount: null, createdAt: member.createdAt.toISOString() });
  */
});

router.patch("/external/v1/members/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid member ID" }); return; }
  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof membersTable.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.phone === "string" && body.phone.trim()) updates.phone = body.phone.trim();
  if (typeof body.email === "string") updates.email = body.email.trim() || null;
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No allowed changes" }); return; }
  const [member] = await db.update(membersTable).set(updates).where(and(eq(membersTable.id, id), eq(membersTable.merchantId, context.merchant.id))).returning();
  if (!member) { res.status(404).json({ error: "Member not found" }); return; }
  res.json({ id: member.id, loginId: member.loginId, name: member.name, phone: member.phone, email: member.email ?? null, isActive: member.isActive, createdAt: member.createdAt.toISOString() });
});

router.get("/external/v1/transactions", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const offset = (page - 1) * limit;
  const status = stringValue(req.query.status, 40);
  const type = stringValue(req.query.type, 40);
  const search = stringValue(req.query.search, 100);
  const startDate = dateValue(req.query.startDate);
  const endDate = dateValue(req.query.endDate, true);
  const conditions = [eq(transactionsTable.merchantId, context.merchant.id)];
  const storeScope = transactionStoreScope(storeCodesValue(req));
  if (storeScope) conditions.push(storeScope);
  if (status) conditions.push(eq(transactionsTable.status, status));
  if (type) conditions.push(eq(transactionsTable.type, type));
  if (startDate) conditions.push(gte(transactionsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(transactionsTable.createdAt, endDate));
  if (search) conditions.push(or(
    ilike(transactionsTable.trackingNumber, `%${search}%`),
    ilike(transactionsTable.pgTransactionId, `%${search}%`),
  )!);
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db.select().from(transactionsTable).where(scope)
      .orderBy(desc(transactionsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(transactionsTable)
      .where(scope),
  ]);
  res.json({
    page, limit, total: Number(count),
    items: items.map((item) => ({
      id: item.id,
      trackingNumber: item.trackingNumber,
      type: item.type,
      originalAmount: Number(item.originalAmount),
      amount: Number(item.amount),
      fee: Number(item.fee),
      status: item.status,
      providerTransactionId: item.pgTransactionId,
      createdAt: item.createdAt.toISOString(),
      processedAt: item.processedAt?.toISOString() ?? null,
    })),
  });
});

router.get("/external/v1/transactions/:trackingNumber", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const trackingNumber = stringValue(req.params.trackingNumber, 120);
  if (!trackingNumber) { res.status(400).json({ error: "Invalid tracking number" }); return; }
  const storeScope = transactionStoreScope(storeCodesValue(req));
  const [item] = await db.select().from(transactionsTable).where(and(
    eq(transactionsTable.merchantId, context.merchant.id),
    eq(transactionsTable.trackingNumber, trackingNumber),
    ...(storeScope ? [storeScope] : []),
  ));
  if (!item) { res.status(404).json({ error: "Transaction not found" }); return; }
  const events = await db.select({
    provider: paymentEventsTable.provider,
    eventId: paymentEventsTable.eventId,
    eventType: paymentEventsTable.eventType,
    processedAt: paymentEventsTable.processedAt,
  }).from(paymentEventsTable).where(and(
    eq(paymentEventsTable.merchantId, context.merchant.id),
    eq(paymentEventsTable.trackingNumber, trackingNumber),
  )).orderBy(desc(paymentEventsTable.processedAt));
  res.json({
    id: item.id,
    trackingNumber: item.trackingNumber,
    memberId: item.memberId,
    type: item.type,
    originalAmount: Number(item.originalAmount),
    amount: Number(item.amount),
    fee: Number(item.fee),
    status: item.status,
    fromAccount: item.fromAccount,
    toAccount: item.toAccount,
    providerTransactionId: item.pgTransactionId,
    createdAt: item.createdAt.toISOString(),
    processedAt: item.processedAt?.toISOString() ?? null,
    events: events.map((event) => ({ ...event, processedAt: event.processedAt?.toISOString() ?? null })),
  });
});

router.get("/external/v1/withdrawals", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const offset = (page - 1) * limit;
  const approvalStatus = stringValue(req.query.approvalStatus, 40);
  const payoutStatus = stringValue(req.query.payoutStatus, 40);
  const search = stringValue(req.query.search, 100);
  const startDate = dateValue(req.query.startDate);
  const endDate = dateValue(req.query.endDate, true);
  const conditions = [eq(withdrawalsTable.merchantId, context.merchant.id)];
  const storeScope = withdrawalStoreScope(storeCodesValue(req));
  if (storeScope) conditions.push(storeScope);
  if (approvalStatus) conditions.push(eq(withdrawalsTable.approvalStatus, approvalStatus));
  if (payoutStatus) conditions.push(eq(withdrawalsTable.withdrawalStatus, payoutStatus));
  if (startDate) conditions.push(gte(withdrawalsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(withdrawalsTable.createdAt, endDate));
  if (search) conditions.push(or(
    ilike(withdrawalsTable.trackingNumber, `%${search}%`),
    ilike(withdrawalsTable.providerTransactionId, `%${search}%`),
  )!);
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db.select().from(withdrawalsTable).where(scope)
      .orderBy(desc(withdrawalsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(withdrawalsTable)
      .where(scope),
  ]);
  res.json({
    page, limit, total: Number(count),
    items: items.map((item) => ({
      id: item.id,
      trackingNumber: item.trackingNumber,
      amount: Number(item.amount),
      fee: Number(item.fee),
      payoutAmount: Number(item.totalAmount),
      approvalStatus: item.approvalStatus,
      payoutStatus: item.withdrawalStatus,
      providerTransactionId: item.providerTransactionId ?? null,
      createdAt: item.createdAt.toISOString(),
      providerUpdatedAt: item.providerUpdatedAt?.toISOString() ?? null,
    })),
  });
});

router.get("/external/v1/withdrawals/:trackingNumber", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const trackingNumber = stringValue(req.params.trackingNumber, 120);
  if (!trackingNumber) { res.status(400).json({ error: "Invalid tracking number" }); return; }
  const storeScope = withdrawalStoreScope(storeCodesValue(req));
  const [item] = await db.select().from(withdrawalsTable).where(and(
    eq(withdrawalsTable.merchantId, context.merchant.id),
    eq(withdrawalsTable.trackingNumber, trackingNumber),
    ...(storeScope ? [storeScope] : []),
  ));
  if (!item) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  const events = await db.select({
    provider: paymentEventsTable.provider,
    eventId: paymentEventsTable.eventId,
    eventType: paymentEventsTable.eventType,
    processedAt: paymentEventsTable.processedAt,
  }).from(paymentEventsTable).where(and(
    eq(paymentEventsTable.merchantId, context.merchant.id),
    eq(paymentEventsTable.trackingNumber, trackingNumber),
  )).orderBy(desc(paymentEventsTable.processedAt));
  res.json({
    id: item.id,
    trackingNumber: item.trackingNumber,
    memberId: item.memberId,
    storeId: item.storeId,
    amount: Number(item.amount),
    fee: Number(item.fee),
    payoutAmount: Number(item.totalAmount),
    approvalStatus: item.approvalStatus,
    payoutStatus: item.withdrawalStatus,
    accountNumber: item.accountNumber,
    accountBank: item.accountBank,
    accountHolder: item.accountHolder,
    rejectReason: item.rejectReason ?? null,
    providerTransactionId: item.providerTransactionId ?? null,
    providerResultCode: item.providerResultCode ?? null,
    providerResultMessage: item.providerResultMessage ?? null,
    createdAt: item.createdAt.toISOString(),
    approvedAt: item.approvedAt?.toISOString() ?? null,
    paidAt: item.paidAt?.toISOString() ?? null,
    providerUpdatedAt: item.providerUpdatedAt?.toISOString() ?? null,
    events: events.map((event) => ({ ...event, processedAt: event.processedAt?.toISOString() ?? null })),
  });
});

router.get("/external/v1/webhook-events", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const offset = (page - 1) * limit;
  const storeScope = paymentEventStoreScope(storeCodesValue(req));
  const eventScope = and(
    eq(paymentEventsTable.merchantId, context.merchant.id),
    ...(storeScope ? [storeScope] : []),
  );
  const [items, [{ count }]] = await Promise.all([
    db.select({ provider: paymentEventsTable.provider, eventId: paymentEventsTable.eventId, eventType: paymentEventsTable.eventType, trackingNumber: paymentEventsTable.trackingNumber, processedAt: paymentEventsTable.processedAt })
      .from(paymentEventsTable).where(eventScope)
      .orderBy(desc(paymentEventsTable.processedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(paymentEventsTable)
      .where(eventScope),
  ]);
  res.json({ page, limit, total: Number(count), items: items.map((item) => ({ ...item, processedAt: item.processedAt?.toISOString() ?? null })) });
});

export default router;
