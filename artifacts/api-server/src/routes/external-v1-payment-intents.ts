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
import {
  activeAccountStoreScope,
  bankNames,
  dateValue,
  KPPAY_VIRTUAL_BANK_CODE,
  ledgerStoreScope,
  memberStoreScope,
  normalizeBirthdate,
  pageValue,
  paymentEventStoreScope,
  stableJson,
  storeCodesValue,
  stringValue,
  transactionStoreScope,
  virtualAccountStoreScope,
  withdrawalStoreScope,
} from "./external-v1-helpers.js";

import {
  accountForMember,
  authenticated,
  intentAccount,
  paymentIntentResponse,
  providerFailure,
  registrationResponse,
} from "./external-v1-shared.js";
const router = Router();

router.post("/external/v1/payment-intents", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const idempotencyKey = req.get("Idempotency-Key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    res
      .status(400)
      .json({
        error: "Valid Idempotency-Key header is required",
        code: "INVALID_IDEMPOTENCY_KEY",
      });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const merchantOrderId = stringValue(body.merchantOrderId, 100);
  const externalCustomerId = stringValue(body.externalCustomerId, 100) || null;
  const memberId = body.memberId == null ? null : Number(body.memberId);
  const attemptNumber =
    body.attemptNumber == null ? 1 : Number(body.attemptNumber);
  const amount = typeof body.amount === "string" ? body.amount.trim() : "";
  const currency = stringValue(body.currency ?? "KRW", 3).toUpperCase();
  const description = stringValue(body.description, 200) || null;
  const metadata = body.metadata == null ? {} : body.metadata;
  const requestedExpiresAt =
    typeof body.expiresAt === "string" ? body.expiresAt : null;
  const expiresAt = requestedExpiresAt
    ? new Date(requestedExpiresAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const metadataText = stableJson(metadata);

  if (
    !/^[A-Za-z0-9._:-]{1,100}$/.test(merchantOrderId) ||
    (!externalCustomerId && memberId == null) ||
    (externalCustomerId != null &&
      !/^[A-Za-z0-9._:@-]{1,100}$/.test(externalCustomerId)) ||
    (memberId != null && (!Number.isSafeInteger(memberId) || memberId <= 0)) ||
    !Number.isSafeInteger(attemptNumber) ||
    attemptNumber <= 0 ||
    attemptNumber > 999_999 ||
    !/^[1-9]\d{0,14}$/.test(amount) ||
    currency !== "KRW" ||
    !metadata ||
    Array.isArray(metadata) ||
    typeof metadata !== "object" ||
    metadataText.length > 8_192 ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() < Date.now() + 5 * 60 * 1_000 ||
    expiresAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1_000
  ) {
    res
      .status(400)
      .json({
        error: "Invalid payment intent",
        code: "INVALID_PAYMENT_INTENT",
      });
    return;
  }

  const requestHash = crypto
    .createHash("sha256")
    .update(
      stableJson({
        merchantOrderId,
        externalCustomerId,
        memberId,
        attemptNumber,
        amount,
        currency,
        description,
        metadata,
        expiresAt: requestedExpiresAt ? expiresAt.toISOString() : null,
      }),
    )
    .digest("hex");
  const [idempotent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(
      and(
        eq(paymentIntentsTable.merchantId, context.merchant.id),
        eq(paymentIntentsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (idempotent) {
    if (idempotent.requestHash !== requestHash) {
      res
        .status(409)
        .json({
          error: "Idempotency-Key was used with different input",
          code: "IDEMPOTENCY_CONFLICT",
        });
      return;
    }
    res.json(
      paymentIntentResponse(idempotent, await intentAccount(idempotent)),
    );
    return;
  }

  let account: typeof virtualAccountsTable.$inferSelect | null = null;
  if (memberId != null) {
    const [member] = await db
      .select()
      .from(membersTable)
      .where(
        and(
          eq(membersTable.id, memberId),
          eq(membersTable.merchantId, context.merchant.id),
        ),
      )
      .limit(1);
    if (!member) {
      res
        .status(404)
        .json({ error: "Member not found", code: "MEMBER_NOT_FOUND" });
      return;
    }
    account = await accountForMember(member.id);
    if (
      !member.isActive ||
      !member.isVerified ||
      !account ||
      account.merchantId !== context.merchant.id
    )
      account = null;
  }

  const publicId = `pi_${crypto.randomUUID().replace(/-/g, "")}`;
  const providerTrackingNumber = createPaymentIntentTrackId({
    merchantId: context.merchant.id,
    merchantOrderId,
    attemptNumber,
  });
  try {
    const intent = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(paymentIntentsTable)
        .values({
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
        })
        .returning();
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
          payload: {
            status: created.status,
            memberId: created.memberId,
            virtualAccountId: created.virtualAccountId,
          },
        });
      }
      return created;
    });
    res.status(201).json(paymentIntentResponse(intent, account));
  } catch {
    const [replayed] = await db
      .select()
      .from(paymentIntentsTable)
      .where(
        and(
          eq(paymentIntentsTable.merchantId, context.merchant.id),
          eq(paymentIntentsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (replayed?.requestHash === requestHash) {
      res.json(paymentIntentResponse(replayed, await intentAccount(replayed)));
      return;
    }
    const [orderConflict] = await db
      .select()
      .from(paymentIntentsTable)
      .where(
        and(
          eq(paymentIntentsTable.merchantId, context.merchant.id),
          eq(paymentIntentsTable.merchantOrderId, merchantOrderId),
          eq(paymentIntentsTable.attemptNumber, attemptNumber),
        ),
      )
      .limit(1);
    if (orderConflict) {
      res
        .status(409)
        .json({
          error: "merchantOrderId already exists",
          code: "MERCHANT_ORDER_EXISTS",
        });
      return;
    }
    throw new Error("PAYMENT_INTENT_CREATE_FAILED");
  }
});

router.get("/external/v1/payment-intents/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = stringValue(req.params.id, 80);
  const [intent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(
      and(
        eq(paymentIntentsTable.publicId, id),
        eq(paymentIntentsTable.merchantId, context.merchant.id),
      ),
    )
    .limit(1);
  if (!intent) {
    res
      .status(404)
      .json({
        error: "Payment intent not found",
        code: "PAYMENT_INTENT_NOT_FOUND",
      });
    return;
  }
  res.json(paymentIntentResponse(intent, await intentAccount(intent)));
});

router.get("/external/v1/payment-intents", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchantOrderId = stringValue(req.query.merchantOrderId, 100);
  const rawAttemptNumber = req.query.attemptNumber;
  const attemptNumber =
    rawAttemptNumber == null ? null : Number(rawAttemptNumber);
  if (!merchantOrderId) {
    res
      .status(400)
      .json({
        error: "merchantOrderId is required",
        code: "INVALID_MERCHANT_ORDER_ID",
      });
    return;
  }
  if (
    attemptNumber != null &&
    (!Number.isSafeInteger(attemptNumber) || attemptNumber <= 0)
  ) {
    res
      .status(400)
      .json({ error: "Invalid attemptNumber", code: "INVALID_ATTEMPT_NUMBER" });
    return;
  }
  const [intent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(
      and(
        eq(paymentIntentsTable.merchantId, context.merchant.id),
        eq(paymentIntentsTable.merchantOrderId, merchantOrderId),
        ...(attemptNumber == null
          ? []
          : [eq(paymentIntentsTable.attemptNumber, attemptNumber)]),
      ),
    )
    .orderBy(desc(paymentIntentsTable.attemptNumber))
    .limit(1);
  if (!intent) {
    res
      .status(404)
      .json({
        error: "Payment intent not found",
        code: "PAYMENT_INTENT_NOT_FOUND",
      });
    return;
  }
  res.json(paymentIntentResponse(intent, await intentAccount(intent)));
});

router.post("/external/v1/payment-intents/:id/member", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = stringValue(req.params.id, 80);
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const memberId = Number(body.memberId);
  if (
    !/^pi_[a-f0-9]{32}$/.test(id) ||
    Object.keys(body).some((key) => key !== "memberId") ||
    !Number.isSafeInteger(memberId) ||
    memberId <= 0
  ) {
    res
      .status(400)
      .json({ error: "Valid memberId is required", code: "INVALID_MEMBER_ID" });
    return;
  }

  const [intent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(
      and(
        eq(paymentIntentsTable.publicId, id),
        eq(paymentIntentsTable.merchantId, context.merchant.id),
      ),
    )
    .limit(1);
  if (!intent) {
    res
      .status(404)
      .json({
        error: "Payment intent not found",
        code: "PAYMENT_INTENT_NOT_FOUND",
      });
    return;
  }

  const [member] = await db
    .select()
    .from(membersTable)
    .where(
      and(
        eq(membersTable.id, memberId),
        eq(membersTable.merchantId, context.merchant.id),
        eq(membersTable.isActive, true),
        eq(membersTable.isVerified, true),
      ),
    )
    .limit(1);
  if (!member) {
    res
      .status(409)
      .json({
        error: "Member is not active and verified",
        code: "MEMBER_NOT_READY",
      });
    return;
  }
  const account = await accountForMember(member.id);
  if (
    !account ||
    account.merchantId !== context.merchant.id ||
    account.status !== "active"
  ) {
    res
      .status(409)
      .json({
        error: "Member has no active virtual account",
        code: "VIRTUAL_ACCOUNT_NOT_READY",
      });
    return;
  }

  if (isPaymentIntentMemberReplay(intent.status, intent.memberId, memberId)) {
    res.json(paymentIntentResponse(intent, await intentAccount(intent)));
    return;
  }
  if (intent.status !== "requires_member") {
    res
      .status(409)
      .json({
        error: "Payment intent member cannot be changed",
        code: "PAYMENT_INTENT_MEMBER_CONFLICT",
      });
    return;
  }

  const attached = await db.transaction(async (tx) => {
    const [changed] = await tx
      .update(paymentIntentsTable)
      .set({
        memberId,
        virtualAccountId: account.id,
        status: "awaiting_deposit",
        updatedAt: new Date(),
        version: sql`${paymentIntentsTable.version} + 1`,
      })
      .where(
        and(
          eq(paymentIntentsTable.id, intent.id),
          eq(paymentIntentsTable.status, "requires_member"),
        ),
      )
      .returning();
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

  const [concurrent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(
      and(
        eq(paymentIntentsTable.id, intent.id),
        eq(paymentIntentsTable.merchantId, context.merchant.id),
      ),
    )
    .limit(1);
  if (
    concurrent &&
    isPaymentIntentMemberReplay(
      concurrent.status,
      concurrent.memberId,
      memberId,
    )
  ) {
    res.json(
      paymentIntentResponse(concurrent, await intentAccount(concurrent)),
    );
    return;
  }
  res
    .status(409)
    .json({
      error: "Payment intent state changed",
      code: "PAYMENT_INTENT_STATE_CONFLICT",
    });
});

router.post("/external/v1/payment-intents/:id/cancel", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = stringValue(req.params.id, 80);
  const [existing] = await db
    .select()
    .from(paymentIntentsTable)
    .where(
      and(
        eq(paymentIntentsTable.publicId, id),
        eq(paymentIntentsTable.merchantId, context.merchant.id),
      ),
    )
    .limit(1);
  if (!existing) {
    res
      .status(404)
      .json({
        error: "Payment intent not found",
        code: "PAYMENT_INTENT_NOT_FOUND",
      });
    return;
  }
  if (existing.status === "cancelled") {
    res.json(paymentIntentResponse(existing, await intentAccount(existing)));
    return;
  }
  if (!["requires_member", "awaiting_deposit"].includes(existing.status)) {
    res
      .status(409)
      .json({
        error: "Payment intent cannot be cancelled",
        code: "INVALID_PAYMENT_INTENT_STATE",
      });
    return;
  }
  const cancelled = await db.transaction(async (tx) => {
    const [changed] = await tx
      .update(paymentIntentsTable)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
        version: sql`${paymentIntentsTable.version} + 1`,
      })
      .where(
        and(
          eq(paymentIntentsTable.id, existing.id),
          inArray(paymentIntentsTable.status, [
            "requires_member",
            "awaiting_deposit",
          ]),
        ),
      )
      .returning();
    if (!changed) return null;
    await tx
      .insert(paymentIntentEventsTable)
      .values({
        paymentIntentId: changed.id,
        eventType: "payment_intent.cancelled",
        source: "merchant_api",
        sourceEventId: `cancel:${changed.publicId}`,
        payload: { status: changed.status },
      })
      .onConflictDoNothing();
    return changed;
  });
  if (!cancelled) {
    res
      .status(409)
      .json({
        error: "Payment intent state changed",
        code: "PAYMENT_INTENT_STATE_CONFLICT",
      });
    return;
  }
  res.json(paymentIntentResponse(cancelled, await intentAccount(cancelled)));
});

export default router;
