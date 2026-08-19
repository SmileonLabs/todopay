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
  if (search)
    conditions.push(
      or(
        ilike(transactionsTable.trackingNumber, `%${search}%`),
        ilike(transactionsTable.pgTransactionId, `%${search}%`),
      )!,
    );
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db
      .select()
      .from(transactionsTable)
      .where(scope)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(scope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
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
  if (!trackingNumber) {
    res.status(400).json({ error: "Invalid tracking number" });
    return;
  }
  const storeScope = transactionStoreScope(storeCodesValue(req));
  const [item] = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.merchantId, context.merchant.id),
        eq(transactionsTable.trackingNumber, trackingNumber),
        ...(storeScope ? [storeScope] : []),
      ),
    );
  if (!item) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  const events = await db
    .select({
      provider: paymentEventsTable.provider,
      eventId: paymentEventsTable.eventId,
      eventType: paymentEventsTable.eventType,
      processedAt: paymentEventsTable.processedAt,
    })
    .from(paymentEventsTable)
    .where(
      and(
        eq(paymentEventsTable.merchantId, context.merchant.id),
        eq(paymentEventsTable.trackingNumber, trackingNumber),
      ),
    )
    .orderBy(desc(paymentEventsTable.processedAt));
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
    events: events.map((event) => ({
      ...event,
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
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
  if (approvalStatus)
    conditions.push(eq(withdrawalsTable.approvalStatus, approvalStatus));
  if (payoutStatus)
    conditions.push(eq(withdrawalsTable.withdrawalStatus, payoutStatus));
  if (startDate) conditions.push(gte(withdrawalsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(withdrawalsTable.createdAt, endDate));
  if (search)
    conditions.push(
      or(
        ilike(withdrawalsTable.trackingNumber, `%${search}%`),
        ilike(withdrawalsTable.providerTransactionId, `%${search}%`),
      )!,
    );
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db
      .select()
      .from(withdrawalsTable)
      .where(scope)
      .orderBy(desc(withdrawalsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .where(scope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
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
  if (!trackingNumber) {
    res.status(400).json({ error: "Invalid tracking number" });
    return;
  }
  const storeScope = withdrawalStoreScope(storeCodesValue(req));
  const [item] = await db
    .select()
    .from(withdrawalsTable)
    .where(
      and(
        eq(withdrawalsTable.merchantId, context.merchant.id),
        eq(withdrawalsTable.trackingNumber, trackingNumber),
        ...(storeScope ? [storeScope] : []),
      ),
    );
  if (!item) {
    res.status(404).json({ error: "Withdrawal not found" });
    return;
  }
  const events = await db
    .select({
      provider: paymentEventsTable.provider,
      eventId: paymentEventsTable.eventId,
      eventType: paymentEventsTable.eventType,
      processedAt: paymentEventsTable.processedAt,
    })
    .from(paymentEventsTable)
    .where(
      and(
        eq(paymentEventsTable.merchantId, context.merchant.id),
        eq(paymentEventsTable.trackingNumber, trackingNumber),
      ),
    )
    .orderBy(desc(paymentEventsTable.processedAt));
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
    events: events.map((event) => ({
      ...event,
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
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
    db
      .select({
        provider: paymentEventsTable.provider,
        eventId: paymentEventsTable.eventId,
        eventType: paymentEventsTable.eventType,
        trackingNumber: paymentEventsTable.trackingNumber,
        processedAt: paymentEventsTable.processedAt,
      })
      .from(paymentEventsTable)
      .where(eventScope)
      .orderBy(desc(paymentEventsTable.processedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(paymentEventsTable)
      .where(eventScope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
    items: items.map((item) => ({
      ...item,
      processedAt: item.processedAt?.toISOString() ?? null,
    })),
  });
});

export default router;
