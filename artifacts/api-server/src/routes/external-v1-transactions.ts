import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
  isDateInput,
  KPPAY_VIRTUAL_BANK_CODE,
  ledgerStoreScope,
  maskAccount,
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
const withdrawalStore = alias(adminUsersTable, "external_withdrawal_store");
const withdrawalApprover = alias(
  adminUsersTable,
  "external_withdrawal_approver",
);
const transactionMember = alias(membersTable, "external_transaction_member");
const transactionStore = alias(adminUsersTable, "external_transaction_store");

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
  if (
    (req.query.startDate !== undefined && !isDateInput(req.query.startDate)) ||
    (req.query.endDate !== undefined && !isDateInput(req.query.endDate)) ||
    (startDate && endDate && startDate > endDate) ||
    (status &&
      !["received", "processing", "pending", "success", "failed"].includes(
        status,
      )) ||
    (type && !["deposit", "withdrawal"].includes(type))
  ) {
    res
      .status(400)
      .json({ error: "Invalid transaction filter", code: "INVALID_FILTER" });
    return;
  }
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
        ilike(transactionMember.name, `%${search}%`),
        ilike(transactionStore.loginId, `%${search}%`),
        ilike(transactionStore.name, `%${search}%`),
        ilike(transactionsTable.fromAccount, `%${search}%`),
        ilike(transactionsTable.toAccount, `%${search}%`),
      )!,
    );
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db
      .select({
        transaction: transactionsTable,
        memberName: transactionMember.name,
        storeCode: transactionStore.loginId,
        storeName: transactionStore.name,
      })
      .from(transactionsTable)
      .leftJoin(
        transactionMember,
        eq(transactionMember.id, transactionsTable.memberId),
      )
      .leftJoin(
        transactionStore,
        eq(transactionStore.id, transactionMember.storeId),
      )
      .where(scope)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(transactionsTable)
      .leftJoin(
        transactionMember,
        eq(transactionMember.id, transactionsTable.memberId),
      )
      .leftJoin(
        transactionStore,
        eq(transactionStore.id, transactionMember.storeId),
      )
      .where(scope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
    items: items.map((row) => {
      const item = row.transaction;
      return {
        id: item.id,
        trackingNumber: item.trackingNumber,
        type: item.type,
        originalAmount: Number(item.originalAmount),
        amount: Number(item.amount),
        fee: Number(item.fee),
        status: item.status,
        storeCode: row.storeCode ?? null,
        storeName: row.storeName ?? null,
        memberName: row.memberName ?? null,
        depositorName: null,
        fromAccountMasked: maskAccount(item.fromAccount),
        toAccountMasked: maskAccount(item.toAccount),
        runningBalance: null,
        providerTransactionId: item.pgTransactionId,
        createdAt: item.createdAt.toISOString(),
        processedAt: item.processedAt?.toISOString() ?? null,
      };
    }),
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
  if (
    (req.query.startDate !== undefined && !isDateInput(req.query.startDate)) ||
    (req.query.endDate !== undefined && !isDateInput(req.query.endDate)) ||
    (startDate && endDate && startDate > endDate) ||
    (approvalStatus &&
      !["pending", "approved", "rejected"].includes(approvalStatus)) ||
    (payoutStatus &&
      ![
        "unpaid",
        "submitting",
        "processing",
        "paid",
        "failed",
        "unknown",
      ].includes(payoutStatus))
  ) {
    res
      .status(400)
      .json({ error: "Invalid withdrawal filter", code: "INVALID_FILTER" });
    return;
  }
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
        ilike(withdrawalStore.loginId, `%${search}%`),
        ilike(withdrawalStore.name, `%${search}%`),
      )!,
    );
  const scope = and(...conditions);
  const [items, [{ count }], [totals]] = await Promise.all([
    db
      .select({
        withdrawal: withdrawalsTable,
        storeCode: withdrawalStore.loginId,
        storeName: withdrawalStore.name,
        approvedByName: withdrawalApprover.name,
      })
      .from(withdrawalsTable)
      .leftJoin(
        withdrawalStore,
        eq(withdrawalStore.id, withdrawalsTable.storeId),
      )
      .leftJoin(
        withdrawalApprover,
        eq(withdrawalApprover.id, withdrawalsTable.approvedBy),
      )
      .where(scope)
      .orderBy(desc(withdrawalsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .leftJoin(
        withdrawalStore,
        eq(withdrawalStore.id, withdrawalsTable.storeId),
      )
      .where(scope),
    db
      .select({
        totalAmount: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
        feeAmount: sql<number>`coalesce(sum(${withdrawalsTable.fee}), 0)`,
        actualWithdrawalAmount: sql<number>`coalesce(sum(${withdrawalsTable.totalAmount}) filter (where ${withdrawalsTable.withdrawalStatus} = 'paid'), 0)`,
      })
      .from(withdrawalsTable)
      .leftJoin(
        withdrawalStore,
        eq(withdrawalStore.id, withdrawalsTable.storeId),
      )
      .where(scope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
    totalAmount: Number(totals.totalAmount),
    withdrawalFeeAmount: Number(totals.feeAmount),
    actualWithdrawalAmount: Number(totals.actualWithdrawalAmount),
    items: items.map((row) => {
      const item = row.withdrawal;
      return {
        id: item.id,
        trackingNumber: item.trackingNumber,
        amount: Number(item.amount),
        totalAmount: Number(item.amount),
        fee: Number(item.fee),
        payoutAmount: Number(item.totalAmount),
        actualWithdrawalAmount:
          item.withdrawalStatus === "paid" ? Number(item.totalAmount) : null,
        approvalStatus: item.approvalStatus,
        payoutStatus: item.withdrawalStatus,
        approvedBy:
          row.approvedByName ??
          (item.approvedBy == null ? null : String(item.approvedBy)),
        storeCode: row.storeCode ?? null,
        storeName: row.storeName ?? null,
        providerTransactionId: item.providerTransactionId ?? null,
        createdAt: item.createdAt.toISOString(),
        providerUpdatedAt: item.providerUpdatedAt?.toISOString() ?? null,
      };
    }),
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
