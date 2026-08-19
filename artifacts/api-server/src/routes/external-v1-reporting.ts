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
  booleanValue,
  dateValue,
  isDateInput,
  kstDate,
  kstDaysSince,
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
const virtualAccountMember = alias(
  membersTable,
  "external_virtual_account_member",
);
const virtualAccountStore = alias(
  adminUsersTable,
  "external_virtual_account_store",
);
const issuedAccount = alias(virtualAccountsTable, "external_issued_account");

router.get("/external/v1/fees", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const [fee] = await db
    .select()
    .from(merchantFeeConfigsTable)
    .where(eq(merchantFeeConfigsTable.merchantId, context.merchant.id))
    .limit(1);
  res.json(
    fee
      ? {
          configured: true,
          depositFee: fee.depositFee,
          withdrawalFee: fee.withdrawalFee,
          usageFeeRate: Number(fee.usageFeeRate),
          effectiveFrom: fee.effectiveFrom.toISOString(),
          updatedAt: fee.updatedAt.toISOString(),
        }
      : {
          configured: false,
          depositFee: null,
          withdrawalFee: null,
          usageFeeRate: null,
          effectiveFrom: null,
          updatedAt: null,
        },
  );
});

router.get("/external/v1/balance", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const storeCodes = storeCodesValue(req);
  const storeScope = ledgerStoreScope(storeCodes);
  const withdrawalScope = withdrawalStoreScope(storeCodes);
  const balanceScope = and(
    eq(moneyLedgerTable.merchantId, context.merchant.id),
    ...(storeScope ? [storeScope] : []),
  );
  const [[row], [holding]] = await Promise.all([
    db
      .select({
        availableBalance: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'credit' then ${moneyLedgerTable.amount} else -${moneyLedgerTable.amount} end), 0)`,
        creditTotal: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'credit' then ${moneyLedgerTable.amount} else 0 end), 0)`,
        debitTotal: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'debit' then ${moneyLedgerTable.amount} else 0 end), 0)`,
      })
      .from(moneyLedgerTable)
      .where(balanceScope),
    db
      .select({
        value: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
      })
      .from(withdrawalsTable)
      .where(
        and(
          eq(withdrawalsTable.merchantId, context.merchant.id),
          sql`${withdrawalsTable.approvalStatus} != 'rejected'`,
          inArray(withdrawalsTable.withdrawalStatus, [
            "unpaid",
            "submitting",
            "processing",
            "unknown",
          ]),
          ...(withdrawalScope ? [withdrawalScope] : []),
        ),
      ),
  ]);
  res.json({
    currency: "KRW",
    availableBalance: Number(row.availableBalance),
    holdingAmount: Number(holding.value),
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
  const search = stringValue(req.query.search, 100);
  const unfundedOnly = booleanValue(req.query.unfundedOnly);
  if (req.query.unfundedOnly !== undefined && unfundedOnly === null) {
    res.status(400).json({
      error: "unfundedOnly must be true or false",
      code: "INVALID_FILTER",
    });
    return;
  }
  const issuanceStatuses = [
    "requesting",
    "awaiting_verification",
    "issued",
    "failed",
    "cancelled",
    "expired",
  ];
  const accountStatuses = ["active", "revoked"];
  if (status && ![...issuanceStatuses, ...accountStatuses].includes(status)) {
    res.status(400).json({
      error: "Invalid virtual account status",
      code: "INVALID_FILTER",
    });
    return;
  }
  const conditions = [
    eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
  ];
  const storeScope = virtualAccountStoreScope(storeCodesValue(req));
  if (storeScope) conditions.push(storeScope);
  if (status && issuanceStatuses.includes(status))
    conditions.push(eq(virtualAccountIssuancesTable.status, status));
  if (status && accountStatuses.includes(status))
    conditions.push(eq(issuedAccount.status, status));
  const lastDepositAt = sql<Date | null>`(
    select max(deposit.created_at)
    from transactions deposit
    where deposit.merchant_id = ${context.merchant.id}
      and deposit.member_id = ${virtualAccountIssuancesTable.memberId}
      and deposit.type = 'deposit'
      and deposit.status = 'success'
  )`;
  if (unfundedOnly === true) conditions.push(sql`${lastDepositAt} is null`);
  if (search)
    conditions.push(
      or(
        ilike(virtualAccountIssuancesTable.virtualAccountNumber, `%${search}%`),
        ilike(virtualAccountIssuancesTable.providerIssueId, `%${search}%`),
        ilike(virtualAccountIssuancesTable.trackingNumber, `%${search}%`),
        ilike(virtualAccountMember.name, `%${search}%`),
        ilike(virtualAccountStore.name, `%${search}%`),
        ilike(virtualAccountStore.loginId, `%${search}%`),
      )!,
    );
  const scope = and(...conditions);
  const [items, [{ count }]] = await Promise.all([
    db
      .select({
        issuance: virtualAccountIssuancesTable,
        memberName: virtualAccountMember.name,
        storeCode: virtualAccountStore.loginId,
        storeName: virtualAccountStore.name,
        bankName: issuedAccount.bankName,
        accountStatus: issuedAccount.status,
        lastDepositAt,
      })
      .from(virtualAccountIssuancesTable)
      .leftJoin(
        virtualAccountMember,
        eq(virtualAccountMember.id, virtualAccountIssuancesTable.memberId),
      )
      .leftJoin(
        virtualAccountStore,
        eq(virtualAccountStore.id, virtualAccountMember.storeId),
      )
      .leftJoin(
        issuedAccount,
        and(
          eq(issuedAccount.memberId, virtualAccountIssuancesTable.memberId),
          eq(
            issuedAccount.accountNumber,
            virtualAccountIssuancesTable.virtualAccountNumber,
          ),
        ),
      )
      .where(scope)
      .orderBy(desc(virtualAccountIssuancesTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(virtualAccountIssuancesTable)
      .leftJoin(
        virtualAccountMember,
        eq(virtualAccountMember.id, virtualAccountIssuancesTable.memberId),
      )
      .leftJoin(
        virtualAccountStore,
        eq(virtualAccountStore.id, virtualAccountMember.storeId),
      )
      .leftJoin(
        issuedAccount,
        and(
          eq(issuedAccount.memberId, virtualAccountIssuancesTable.memberId),
          eq(
            issuedAccount.accountNumber,
            virtualAccountIssuancesTable.virtualAccountNumber,
          ),
        ),
      )
      .where(scope),
  ]);
  res.json({
    page,
    limit,
    total: Number(count),
    items: items.map((row) => {
      const item = row.issuance;
      const depositAt = row.lastDepositAt ? new Date(row.lastDepositAt) : null;
      return {
        id: item.id,
        storeCode: row.storeCode ?? null,
        storeName: row.storeName ?? null,
        memberId: item.memberId,
        memberName: row.memberName ?? null,
        bankName: row.bankName ?? bankNames[item.virtualBankCode] ?? null,
        bankCode: item.virtualBankCode,
        accountNumber: item.virtualAccountNumber,
        accountHolder: null,
        issueId: item.providerIssueId ?? null,
        trackId: item.trackingNumber,
        trackingNumber: item.trackingNumber,
        status: row.accountStatus ?? item.status,
        issuanceStatus: item.status,
        lastDepositAt: depositAt?.toISOString() ?? null,
        daysSinceLastDeposit: depositAt ? kstDaysSince(depositAt) : null,
        expiresAt: item.expiresAt?.toISOString() ?? null,
        verifiedAt: item.verifiedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    }),
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
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [
    [memberCount],
    [transactionCount],
    [pendingWithdrawals],
    [todayDeposits],
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(membersTable)
      .where(
        and(
          eq(membersTable.merchantId, merchantId),
          ...(memberStore ? [memberStore] : []),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.merchantId, merchantId),
          ...(transactionStore ? [transactionStore] : []),
        ),
      ),
    db
      .select({
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
      })
      .from(withdrawalsTable)
      .where(
        and(
          eq(withdrawalsTable.merchantId, merchantId),
          eq(withdrawalsTable.approvalStatus, "pending"),
          ...(withdrawalStore ? [withdrawalStore] : []),
        ),
      ),
    db
      .select({
        amount: sql<number>`coalesce(sum(${transactionsTable.amount}), 0)`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.merchantId, merchantId),
          eq(transactionsTable.type, "deposit"),
          gte(transactionsTable.createdAt, since),
          ...(transactionStore ? [transactionStore] : []),
        ),
      ),
  ]);
  res.json({
    members: Number(memberCount.count),
    transactions: Number(transactionCount.count),
    pendingWithdrawals: {
      count: Number(pendingWithdrawals.count),
      amount: Number(pendingWithdrawals.amount),
    },
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
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const txWhere = (since: Date, type?: string) =>
    and(
      eq(transactionsTable.merchantId, merchantId),
      eq(transactionsTable.status, "success"),
      ...(type ? [eq(transactionsTable.type, type)] : []),
      gte(transactionsTable.createdAt, since),
      ...(transactionStore ? [transactionStore] : []),
    );
  const wdWhere = (since: Date) =>
    and(
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
    db
      .select({
        value: sql<number>`coalesce(sum(${transactionsTable.originalAmount}), 0)`,
      })
      .from(transactionsTable)
      .where(txWhere(todayStart, "deposit")),
    db
      .select({
        value: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
      })
      .from(withdrawalsTable)
      .where(wdWhere(todayStart)),
    db
      .select({
        value: sql<number>`coalesce(sum(${transactionsTable.fee}), 0)`,
      })
      .from(transactionsTable)
      .where(txWhere(todayStart)),
    db
      .select({
        value: sql<number>`coalesce(sum(${transactionsTable.originalAmount}), 0)`,
      })
      .from(transactionsTable)
      .where(txWhere(monthStart, "deposit")),
    db
      .select({
        value: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
      })
      .from(withdrawalsTable)
      .where(wdWhere(monthStart)),
    db
      .select({ value: sql<number>`count(*)` })
      .from(membersTable)
      .where(
        and(
          eq(membersTable.merchantId, merchantId),
          ...(memberStore ? [memberStore] : []),
        ),
      ),
    db
      .select({ value: sql<number>`count(*)` })
      .from(virtualAccountsTable)
      .where(
        and(
          eq(virtualAccountsTable.merchantId, merchantId),
          eq(virtualAccountsTable.status, "active"),
          ...(accountStore ? [accountStore] : []),
        ),
      ),
    db
      .select({ value: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .where(
        and(
          eq(withdrawalsTable.merchantId, merchantId),
          eq(withdrawalsTable.approvalStatus, "pending"),
          ...(withdrawalStore ? [withdrawalStore] : []),
        ),
      ),
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
  if (
    (req.query.startDate !== undefined && !isDateInput(req.query.startDate)) ||
    (req.query.endDate !== undefined && !isDateInput(req.query.endDate))
  ) {
    res.status(400).json({
      code: "INVALID_DATE_RANGE",
      error: "startDate와 endDate는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.",
    });
    return;
  }
  const today = kstDate(new Date());
  const defaultEnd = dateValue(today, true)!;
  const defaultStart = new Date(dateValue(today)!.getTime() - 29 * 86_400_000);
  const startDate = dateValue(req.query.startDate) ?? defaultStart;
  const endDate = dateValue(req.query.endDate, true) ?? defaultEnd;
  if (startDate > endDate) {
    res.status(400).json({
      code: "INVALID_DATE_RANGE",
      error: "startDate는 endDate보다 늦을 수 없습니다.",
    });
    return;
  }
  if (endDate.getTime() - startDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
    res.status(400).json({
      code: "DATE_RANGE_TOO_LARGE",
      error: "통계 조회 기간은 최대 366일입니다.",
    });
    return;
  }
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 366);
  const storeCodes = storeCodesValue(req);
  const transactionStore = transactionStoreScope(storeCodes);
  const withdrawalStore = withdrawalStoreScope(storeCodes);
  const ledgerStore = ledgerStoreScope(storeCodes);
  const txDate = sql<string>`to_char(timezone('Asia/Seoul', ${transactionsTable.createdAt}), 'YYYY-MM-DD')`;
  const wdDate = sql<string>`to_char(timezone('Asia/Seoul', ${withdrawalsTable.createdAt}), 'YYYY-MM-DD')`;
  const paidDate = sql<string>`to_char(timezone('Asia/Seoul', ${withdrawalsTable.paidAt}), 'YYYY-MM-DD')`;
  const ledgerDate = sql<string>`to_char(timezone('Asia/Seoul', ${moneyLedgerTable.createdAt}), 'YYYY-MM-DD')`;
  const [transactionRows, withdrawalRows, paidRows, ledgerRows, [openingRow]] =
    await Promise.all([
      db
        .select({
          date: txDate,
          depositCount: sql<number>`count(*) filter (where ${transactionsTable.type} = 'deposit')`,
          depositAmount: sql<number>`coalesce(sum(${transactionsTable.originalAmount}) filter (where ${transactionsTable.type} = 'deposit'), 0)`,
          netDepositAmount: sql<number>`coalesce(sum(${transactionsTable.amount}) filter (where ${transactionsTable.type} = 'deposit'), 0)`,
          feeAmount: sql<number>`coalesce(sum(${transactionsTable.fee}), 0)`,
        })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.merchantId, context.merchant.id),
            eq(transactionsTable.status, "success"),
            gte(transactionsTable.createdAt, startDate),
            lte(transactionsTable.createdAt, endDate),
            ...(transactionStore ? [transactionStore] : []),
          ),
        )
        .groupBy(txDate),
      db
        .select({
          date: wdDate,
          withdrawalCount: sql<number>`count(*)`,
          withdrawalAmount: sql<number>`coalesce(sum(${withdrawalsTable.amount}), 0)`,
        })
        .from(withdrawalsTable)
        .where(
          and(
            eq(withdrawalsTable.merchantId, context.merchant.id),
            sql`${withdrawalsTable.approvalStatus} != 'rejected'`,
            gte(withdrawalsTable.createdAt, startDate),
            lte(withdrawalsTable.createdAt, endDate),
            ...(withdrawalStore ? [withdrawalStore] : []),
          ),
        )
        .groupBy(wdDate),
      db
        .select({
          date: paidDate,
          withdrawalFeeAmount: sql<number>`coalesce(sum(${withdrawalsTable.fee}), 0)`,
          actualWithdrawalAmount: sql<number>`coalesce(sum(${withdrawalsTable.totalAmount}), 0)`,
        })
        .from(withdrawalsTable)
        .where(
          and(
            eq(withdrawalsTable.merchantId, context.merchant.id),
            eq(withdrawalsTable.withdrawalStatus, "paid"),
            gte(withdrawalsTable.paidAt, startDate),
            lte(withdrawalsTable.paidAt, endDate),
            ...(withdrawalStore ? [withdrawalStore] : []),
          ),
        )
        .groupBy(paidDate),
      db
        .select({
          date: ledgerDate,
          reserveAmount: sql<number>`coalesce(sum(${moneyLedgerTable.amount}) filter (where ${moneyLedgerTable.entryType} = 'withdrawal_reserve'), 0)`,
          movement: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'credit' then ${moneyLedgerTable.amount} else -${moneyLedgerTable.amount} end), 0)`,
        })
        .from(moneyLedgerTable)
        .where(
          and(
            eq(moneyLedgerTable.merchantId, context.merchant.id),
            gte(moneyLedgerTable.createdAt, startDate),
            lte(moneyLedgerTable.createdAt, endDate),
            ...(ledgerStore ? [ledgerStore] : []),
          ),
        )
        .groupBy(ledgerDate),
      db
        .select({
          value: sql<number>`coalesce(sum(case when ${moneyLedgerTable.direction} = 'credit' then ${moneyLedgerTable.amount} else -${moneyLedgerTable.amount} end), 0)`,
        })
        .from(moneyLedgerTable)
        .where(
          and(
            eq(moneyLedgerTable.merchantId, context.merchant.id),
            sql`${moneyLedgerTable.createdAt} < ${startDate}`,
            ...(ledgerStore ? [ledgerStore] : []),
          ),
        ),
    ]);
  const byDate = new Map<
    string,
    {
      date: string;
      depositCount: number;
      depositAmount: number;
      netDepositAmount: number;
      withdrawalCount: number;
      withdrawalAmount: number;
      feeAmount: number;
      reserveAmount: number;
      withdrawalFeeAmount: number;
      actualWithdrawalAmount: number;
      movement: number;
    }
  >();
  for (const row of transactionRows) {
    byDate.set(row.date, {
      date: row.date,
      depositCount: Number(row.depositCount),
      depositAmount: Number(row.depositAmount),
      netDepositAmount: Number(row.netDepositAmount),
      withdrawalCount: 0,
      withdrawalAmount: 0,
      feeAmount: Number(row.feeAmount),
      reserveAmount: 0,
      withdrawalFeeAmount: 0,
      actualWithdrawalAmount: 0,
      movement: 0,
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
      reserveAmount: 0,
      withdrawalFeeAmount: 0,
      actualWithdrawalAmount: 0,
      movement: 0,
    };
    item.withdrawalCount = Number(row.withdrawalCount);
    item.withdrawalAmount = Number(row.withdrawalAmount);
    byDate.set(row.date, item);
  }
  for (const row of paidRows) {
    const item = byDate.get(row.date) ?? {
      date: row.date,
      depositCount: 0,
      depositAmount: 0,
      netDepositAmount: 0,
      withdrawalCount: 0,
      withdrawalAmount: 0,
      feeAmount: 0,
      reserveAmount: 0,
      withdrawalFeeAmount: 0,
      actualWithdrawalAmount: 0,
      movement: 0,
    };
    item.withdrawalFeeAmount = Number(row.withdrawalFeeAmount);
    item.actualWithdrawalAmount = Number(row.actualWithdrawalAmount);
    byDate.set(row.date, item);
  }
  for (const row of ledgerRows) {
    const item = byDate.get(row.date) ?? {
      date: row.date,
      depositCount: 0,
      depositAmount: 0,
      netDepositAmount: 0,
      withdrawalCount: 0,
      withdrawalAmount: 0,
      feeAmount: 0,
      reserveAmount: 0,
      withdrawalFeeAmount: 0,
      actualWithdrawalAmount: 0,
      movement: 0,
    };
    item.reserveAmount = Number(row.reserveAmount);
    item.movement = Number(row.movement);
    byDate.set(row.date, item);
  }

  const allDates: string[] = [];
  for (
    let cursor = startDate.getTime();
    cursor <= endDate.getTime();
    cursor += 86_400_000
  ) {
    allDates.push(kstDate(new Date(cursor)));
  }
  let closingBalance = Number(openingRow.value);
  const allItems = allDates.map((date) => {
    const item = byDate.get(date) ?? {
      date,
      depositCount: 0,
      depositAmount: 0,
      netDepositAmount: 0,
      withdrawalCount: 0,
      withdrawalAmount: 0,
      feeAmount: 0,
      reserveAmount: 0,
      withdrawalFeeAmount: 0,
      actualWithdrawalAmount: 0,
      movement: 0,
    };
    closingBalance += item.movement;
    return {
      date,
      depositCount: item.depositCount,
      depositAmount: item.depositAmount,
      withdrawalCount: item.withdrawalCount,
      withdrawalAmount: item.withdrawalAmount,
      feeAmount: item.feeAmount,
      netAmount: item.netDepositAmount - item.withdrawalAmount,
      reserveAmount: item.reserveAmount,
      profitAmount: item.feeAmount + item.withdrawalFeeAmount,
      withdrawalFeeAmount: item.withdrawalFeeAmount,
      actualWithdrawalAmount: item.actualWithdrawalAmount,
      closingBalance,
    };
  });
  const offset = (page - 1) * limit;
  res.json({
    page,
    limit,
    total: allItems.length,
    items: allItems.slice(offset, offset + limit),
  });
});

export default router;
