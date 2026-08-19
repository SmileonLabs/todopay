import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  membersTable,
  merchantFeeConfigsTable,
  merchantsTable,
  paymentEventsTable,
  reconciliationRunsTable,
  transactionsTable,
  virtualAccountsTable,
  withdrawalsTable,
} from "@workspace/db";
import { hashPassword, isPlatformAdmin, requireAdmin } from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  escapeLike,
  maskAccount,
  maskEmail,
  maskIp,
  maskLoginId,
  maskName,
  maskPhone,
} from "../lib/partner-payment-view.js";
import { connectRedis, redis } from "../lib/redis.js";
import { runFinancialReconciliation } from "../lib/reconciliation-worker.js";

const router = Router();
const PAYMENT_STATUSES = new Set([
  "received",
  "processing",
  "pending",
  "success",
  "failed",
]);
const WITHDRAWAL_STATUSES = new Set([
  "unpaid",
  "processing",
  "paid",
  "failed",
  "unknown",
]);
const APPROVAL_STATUSES = new Set(["pending", "approved", "rejected"]);

async function requirePlatform(req: Request, res: Response) {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!isPlatformAdmin(caller)) {
    res.status(403).json({ error: "Platform administrator required" });
    return null;
  }
  return caller;
}

function parseDate(value: unknown, endOfDay = false) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function pageParams(req: Request) {
  const page = Math.max(
    1,
    Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
  );
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20),
  );
  return { page, limit, offset: (page - 1) * limit };
}

function pagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

router.get("/platform/overview", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    [{ merchantCount }],
    [{ activeMerchantCount }],
    [{ paymentCount }],
    [{ paymentAmount }],
    [{ failedPaymentCount }],
    [{ pendingWithdrawalCount }],
    [{ webhookCount }],
    [{ webhookFailureCount }],
  ] = await Promise.all([
    db.select({ merchantCount: sql<number>`count(*)` }).from(merchantsTable),
    db
      .select({ activeMerchantCount: sql<number>`count(*)` })
      .from(merchantsTable)
      .where(eq(merchantsTable.status, "active")),
    db
      .select({ paymentCount: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.type, "deposit"),
          gte(transactionsTable.createdAt, today),
        ),
      ),
    db
      .select({
        paymentAmount: sql<number>`coalesce(sum(${transactionsTable.originalAmount}), 0)`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.type, "deposit"),
          eq(transactionsTable.status, "success"),
          gte(transactionsTable.createdAt, today),
        ),
      ),
    db
      .select({ failedPaymentCount: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.type, "deposit"),
          eq(transactionsTable.status, "failed"),
          gte(transactionsTable.createdAt, today),
        ),
      ),
    db
      .select({ pendingWithdrawalCount: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.approvalStatus, "pending")),
    db
      .select({ webhookCount: sql<number>`count(*)` })
      .from(paymentEventsTable)
      .where(gte(paymentEventsTable.processedAt, today)),
    db
      .select({ webhookFailureCount: sql<number>`count(*)` })
      .from(paymentEventsTable)
      .where(
        and(
          gte(paymentEventsTable.processedAt, today),
          ilike(paymentEventsTable.eventType, "%fail%"),
        ),
      ),
  ]);

  const failedPayments = Number(failedPaymentCount);
  const pendingWithdrawals = Number(pendingWithdrawalCount);
  const webhookFailures = Number(webhookFailureCount);
  res.json({
    summary: {
      merchantCount: Number(merchantCount),
      activeMerchantCount: Number(activeMerchantCount),
      paymentCount: Number(paymentCount),
      paymentAmount: Number(paymentAmount),
      failedPaymentCount: failedPayments,
      pendingWithdrawalCount: pendingWithdrawals,
      webhookCount: Number(webhookCount),
      webhookFailureCount: webhookFailures,
    },
    alerts: [
      ...(failedPayments > 0
        ? [
            {
              level: "warning",
              code: "payment_failures",
              message: `오늘 실패 결제가 ${failedPayments}건 있습니다.`,
            },
          ]
        : []),
      ...(pendingWithdrawals > 0
        ? [
            {
              level: "info",
              code: "pending_withdrawals",
              message: `승인 대기 출금이 ${pendingWithdrawals}건 있습니다.`,
            },
          ]
        : []),
      ...(webhookFailures > 0
        ? [
            {
              level: "warning",
              code: "webhook_failures",
              message: `오늘 실패 Webhook 이벤트가 ${webhookFailures}건 있습니다.`,
            },
          ]
        : []),
      ...(process.env.PAYMENT_PROVIDER_ENABLED !== "true"
        ? [
            {
              level: "info",
              code: "provider_disabled",
              message: "PG 실연동이 비활성 상태입니다.",
            },
          ]
        : []),
    ],
  });
});

router.get("/platform/merchants/:merchantId/detail", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId) || merchantId <= 0) {
    res.status(400).json({ error: "Invalid merchant id" });
    return;
  }

  const [merchant] = await db
    .select()
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId));
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const [
    [{ members }],
    [{ payments }],
    [{ withdrawals }],
    [{ activeAccounts }],
    operators,
    [fees],
  ] = await Promise.all([
    db
      .select({ members: sql<number>`count(*)` })
      .from(membersTable)
      .where(eq(membersTable.merchantId, merchantId)),
    db
      .select({ payments: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.merchantId, merchantId),
          eq(transactionsTable.type, "deposit"),
        ),
      ),
    db
      .select({ withdrawals: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.merchantId, merchantId)),
    db
      .select({ activeAccounts: sql<number>`count(*)` })
      .from(virtualAccountsTable)
      .where(
        and(
          eq(virtualAccountsTable.merchantId, merchantId),
          eq(virtualAccountsTable.status, "active"),
        ),
      ),
    db
      .select({
        id: adminUsersTable.id,
        loginId: adminUsersTable.loginId,
        name: adminUsersTable.name,
        isActive: adminUsersTable.isActive,
        useOtp: adminUsersTable.useOtp,
        createdAt: adminUsersTable.createdAt,
      })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.merchantId, merchantId))
      .orderBy(desc(adminUsersTable.createdAt)),
    db
      .select()
      .from(merchantFeeConfigsTable)
      .where(eq(merchantFeeConfigsTable.merchantId, merchantId))
      .limit(1),
  ]);

  res.json({
    merchant: {
      id: merchant.id,
      code: merchant.code,
      name: merchant.name,
      status: merchant.status,
      adminDomain: merchant.adminDomain,
      webhookUrl: merchant.webhookUrl,
      allowedIps: merchant.allowedIps ?? [],
      dailyWithdrawalLimit: merchant.dailyWithdrawalLimit,
      apiKeyPrefix: merchant.apiKeyPrefix,
      apiKeyIssued: Boolean(merchant.apiKeyHash),
      createdAt: merchant.createdAt.toISOString(),
      updatedAt: merchant.updatedAt.toISOString(),
    },
    summary: {
      members: Number(members),
      payments: Number(payments),
      withdrawals: Number(withdrawals),
      activeVirtualAccounts: Number(activeAccounts),
    },
    operators: operators.map((operator) => ({
      ...operator,
      loginId: maskLoginId(operator.loginId),
      name: maskName(operator.name),
      createdAt: operator.createdAt.toISOString(),
    })),
    fees: fees
      ? {
          depositFee: fees.depositFee,
          withdrawalFee: fees.withdrawalFee,
          usageFeeRate: Number(fees.usageFeeRate),
          effectiveFrom: fees.effectiveFrom.toISOString(),
        }
      : null,
    integration: {
      apiKeyIssued: Boolean(merchant.apiKeyHash),
      webhookConfigured: Boolean(merchant.webhookUrl),
      allowedIpCount: merchant.allowedIps?.length ?? 0,
      providerEnabled: process.env.PAYMENT_PROVIDER_ENABLED === "true",
    },
  });
});

router.get("/platform/payments", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const { page, limit, offset } = pageParams(req);
  const merchantId = Number.parseInt(String(req.query.merchantId ?? ""), 10);
  const status =
    typeof req.query.status === "string" &&
    PAYMENT_STATUSES.has(req.query.status)
      ? req.query.status
      : "";
  const search =
    typeof req.query.search === "string"
      ? req.query.search.trim().slice(0, 100)
      : "";
  const startDate = parseDate(req.query.startDate);
  const endDate = parseDate(req.query.endDate, true);
  if (req.query.status && !status) {
    res.status(400).json({ error: "Invalid payment status" });
    return;
  }

  const conditions = [eq(transactionsTable.type, "deposit")];
  if (Number.isSafeInteger(merchantId) && merchantId > 0)
    conditions.push(eq(transactionsTable.merchantId, merchantId));
  if (status) conditions.push(eq(transactionsTable.status, status));
  if (startDate) conditions.push(gte(transactionsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(transactionsTable.createdAt, endDate));
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(
      or(
        ilike(transactionsTable.trackingNumber, pattern),
        ilike(transactionsTable.pgTransactionId, pattern),
        ilike(membersTable.loginId, pattern),
        ilike(membersTable.name, pattern),
        ilike(merchantsTable.code, pattern),
        ilike(merchantsTable.name, pattern),
      )!,
    );
  }
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: transactionsTable.id,
        trackingNumber: transactionsTable.trackingNumber,
        pgTransactionId: transactionsTable.pgTransactionId,
        status: transactionsTable.status,
        originalAmount: transactionsTable.originalAmount,
        fee: transactionsTable.fee,
        amount: transactionsTable.amount,
        createdAt: transactionsTable.createdAt,
        processedAt: transactionsTable.processedAt,
        memberName: membersTable.name,
        memberLoginId: membersTable.loginId,
        merchantId: merchantsTable.id,
        merchantCode: merchantsTable.code,
        merchantName: merchantsTable.name,
      })
      .from(transactionsTable)
      .innerJoin(
        merchantsTable,
        eq(merchantsTable.id, transactionsTable.merchantId),
      )
      .leftJoin(
        membersTable,
        and(
          eq(membersTable.id, transactionsTable.memberId),
          eq(membersTable.merchantId, merchantsTable.id),
        ),
      )
      .where(where)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(transactionsTable)
      .innerJoin(
        merchantsTable,
        eq(merchantsTable.id, transactionsTable.merchantId),
      )
      .leftJoin(
        membersTable,
        and(
          eq(membersTable.id, transactionsTable.memberId),
          eq(membersTable.merchantId, merchantsTable.id),
        ),
      )
      .where(where),
  ]);

  res.json({
    items: rows.map((row) => ({
      id: row.id,
      trackingNumber: row.trackingNumber,
      pgTransactionId: row.pgTransactionId,
      status: row.status,
      paymentAmount: Number(row.originalAmount),
      fee: Number(row.fee),
      settlementAmount: Number(row.amount),
      merchant: {
        id: row.merchantId,
        code: row.merchantCode,
        name: row.merchantName,
      },
      member: {
        name: maskName(row.memberName),
        loginId: maskLoginId(row.memberLoginId),
      },
      requestedAt: row.createdAt.toISOString(),
      completedAt: row.processedAt?.toISOString() ?? null,
    })),
    pagination: pagination(page, limit, Number(total)),
  });
});

router.get("/platform/payments/export.csv", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const merchantId = Number.parseInt(String(req.query.merchantId ?? ""), 10);
  const startDate = parseDate(req.query.startDate);
  const endDate = parseDate(req.query.endDate, true);
  const conditions = [eq(transactionsTable.type, "deposit")];
  if (Number.isSafeInteger(merchantId) && merchantId > 0)
    conditions.push(eq(transactionsTable.merchantId, merchantId));
  if (startDate) conditions.push(gte(transactionsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(transactionsTable.createdAt, endDate));
  const rows = await db
    .select({
      merchantCode: merchantsTable.code,
      trackingNumber: transactionsTable.trackingNumber,
      pgTransactionId: transactionsTable.pgTransactionId,
      status: transactionsTable.status,
      originalAmount: transactionsTable.originalAmount,
      fee: transactionsTable.fee,
      amount: transactionsTable.amount,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .innerJoin(
      merchantsTable,
      eq(merchantsTable.id, transactionsTable.merchantId),
    )
    .where(and(...conditions))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(10_000);

  const csv = [
    [
      "가맹점",
      "결제번호",
      "PG거래번호",
      "상태",
      "결제금액",
      "수수료",
      "정산금액",
      "요청일시",
    ]
      .map(csvCell)
      .join(","),
    ...rows.map((row) =>
      [
        row.merchantCode,
        row.trackingNumber,
        row.pgTransactionId,
        row.status,
        row.originalAmount,
        row.fee,
        row.amount,
        row.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");

  await writeAuditLog(req, {
    actorId: caller.id,
    action: "platform.payments.export",
    resourceType: "transaction",
    metadata: {
      merchantId: Number.isSafeInteger(merchantId) ? merchantId : null,
      count: rows.length,
    },
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="todopay-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(`\uFEFF${csv}`);
});

router.get("/platform/payments/:paymentId", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const paymentId = Number(req.params.paymentId);
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    res.status(400).json({ error: "Invalid payment id" });
    return;
  }
  const [payment] = await db
    .select({
      id: transactionsTable.id,
      trackingNumber: transactionsTable.trackingNumber,
      pgTransactionId: transactionsTable.pgTransactionId,
      providerEventId: transactionsTable.providerEventId,
      status: transactionsTable.status,
      originalAmount: transactionsTable.originalAmount,
      fee: transactionsTable.fee,
      amount: transactionsTable.amount,
      fromAccount: transactionsTable.fromAccount,
      toAccount: transactionsTable.toAccount,
      createdAt: transactionsTable.createdAt,
      processedAt: transactionsTable.processedAt,
      merchantId: merchantsTable.id,
      merchantCode: merchantsTable.code,
      merchantName: merchantsTable.name,
      memberId: membersTable.id,
      memberName: membersTable.name,
      memberLoginId: membersTable.loginId,
      memberPhone: membersTable.phone,
      memberEmail: membersTable.email,
    })
    .from(transactionsTable)
    .innerJoin(
      merchantsTable,
      eq(merchantsTable.id, transactionsTable.merchantId),
    )
    .leftJoin(
      membersTable,
      and(
        eq(membersTable.id, transactionsTable.memberId),
        eq(membersTable.merchantId, merchantsTable.id),
      ),
    )
    .where(
      and(
        eq(transactionsTable.id, paymentId),
        eq(transactionsTable.type, "deposit"),
      ),
    )
    .limit(1);
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const events = await db
    .select({
      provider: paymentEventsTable.provider,
      eventType: paymentEventsTable.eventType,
      eventId: paymentEventsTable.eventId,
      processedAt: paymentEventsTable.processedAt,
    })
    .from(paymentEventsTable)
    .where(
      and(
        eq(paymentEventsTable.merchantId, payment.merchantId),
        eq(paymentEventsTable.trackingNumber, payment.trackingNumber),
      ),
    )
    .orderBy(desc(paymentEventsTable.processedAt))
    .limit(100);
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "platform.payment.read",
    resourceType: "transaction",
    resourceId: payment.id,
  });
  res.json({
    id: payment.id,
    trackingNumber: payment.trackingNumber,
    pgTransactionId: payment.pgTransactionId,
    providerEventId: payment.providerEventId,
    status: payment.status,
    paymentAmount: Number(payment.originalAmount),
    fee: Number(payment.fee),
    settlementAmount: Number(payment.amount),
    fromAccount: maskAccount(payment.fromAccount),
    toAccount: maskAccount(payment.toAccount),
    requestedAt: payment.createdAt.toISOString(),
    completedAt: payment.processedAt?.toISOString() ?? null,
    merchant: {
      id: payment.merchantId,
      code: payment.merchantCode,
      name: payment.merchantName,
    },
    member: payment.memberId
      ? {
          id: payment.memberId,
          name: maskName(payment.memberName),
          loginId: maskLoginId(payment.memberLoginId),
          phone: maskPhone(payment.memberPhone),
          email: maskEmail(payment.memberEmail),
        }
      : null,
    events: events.map((event) => ({
      ...event,
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
  });
});

router.get("/platform/withdrawals", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const { page, limit, offset } = pageParams(req);
  const merchantId = Number.parseInt(String(req.query.merchantId ?? ""), 10);
  const approvalStatus =
    typeof req.query.approvalStatus === "string" &&
    APPROVAL_STATUSES.has(req.query.approvalStatus)
      ? req.query.approvalStatus
      : "";
  const withdrawalStatus =
    typeof req.query.withdrawalStatus === "string" &&
    WITHDRAWAL_STATUSES.has(req.query.withdrawalStatus)
      ? req.query.withdrawalStatus
      : "";
  const conditions = [];
  if (Number.isSafeInteger(merchantId) && merchantId > 0)
    conditions.push(eq(withdrawalsTable.merchantId, merchantId));
  if (approvalStatus)
    conditions.push(eq(withdrawalsTable.approvalStatus, approvalStatus));
  if (withdrawalStatus)
    conditions.push(eq(withdrawalsTable.withdrawalStatus, withdrawalStatus));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: withdrawalsTable.id,
        trackingNumber: withdrawalsTable.trackingNumber,
        amount: withdrawalsTable.amount,
        fee: withdrawalsTable.fee,
        totalAmount: withdrawalsTable.totalAmount,
        approvalStatus: withdrawalsTable.approvalStatus,
        withdrawalStatus: withdrawalsTable.withdrawalStatus,
        accountNumber: withdrawalsTable.accountNumber,
        accountBank: withdrawalsTable.accountBank,
        accountHolder: withdrawalsTable.accountHolder,
        providerResultCode: withdrawalsTable.providerResultCode,
        providerResultMessage: withdrawalsTable.providerResultMessage,
        createdAt: withdrawalsTable.createdAt,
        merchantId: merchantsTable.id,
        merchantCode: merchantsTable.code,
        merchantName: merchantsTable.name,
      })
      .from(withdrawalsTable)
      .innerJoin(
        merchantsTable,
        eq(merchantsTable.id, withdrawalsTable.merchantId),
      )
      .where(where)
      .orderBy(desc(withdrawalsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .where(where),
  ]);
  res.json({
    items: rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      fee: Number(row.fee),
      totalAmount: Number(row.totalAmount),
      accountNumber: maskAccount(row.accountNumber),
      accountHolder: maskName(row.accountHolder),
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: pagination(page, limit, Number(total)),
  });
});

router.get("/platform/webhooks", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const { page, limit, offset } = pageParams(req);
  const merchantId = Number.parseInt(String(req.query.merchantId ?? ""), 10);
  const search =
    typeof req.query.search === "string"
      ? req.query.search.trim().slice(0, 100)
      : "";
  const conditions = [];
  if (Number.isSafeInteger(merchantId) && merchantId > 0)
    conditions.push(eq(paymentEventsTable.merchantId, merchantId));
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(
      or(
        ilike(paymentEventsTable.trackingNumber, pattern),
        ilike(paymentEventsTable.eventId, pattern),
        ilike(paymentEventsTable.eventType, pattern),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: paymentEventsTable.id,
        provider: paymentEventsTable.provider,
        eventId: paymentEventsTable.eventId,
        eventType: paymentEventsTable.eventType,
        trackingNumber: paymentEventsTable.trackingNumber,
        processedAt: paymentEventsTable.processedAt,
        merchantId: merchantsTable.id,
        merchantCode: merchantsTable.code,
        merchantName: merchantsTable.name,
      })
      .from(paymentEventsTable)
      .leftJoin(
        merchantsTable,
        eq(merchantsTable.id, paymentEventsTable.merchantId),
      )
      .where(where)
      .orderBy(desc(paymentEventsTable.processedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(paymentEventsTable)
      .where(where),
  ]);
  res.json({
    items: rows.map((row) => ({
      ...row,
      processedAt: row.processedAt?.toISOString() ?? null,
    })),
    pagination: pagination(page, limit, Number(total)),
  });
});

router.get("/platform/audit-logs", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const { page, limit, offset } = pageParams(req);
  const action =
    typeof req.query.action === "string"
      ? req.query.action.trim().slice(0, 100)
      : "";
  const conditions = action
    ? [ilike(auditLogsTable.action, `%${escapeLike(action)}%`)]
    : [];
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: auditLogsTable.id,
        actorId: auditLogsTable.actorId,
        actorType: auditLogsTable.actorType,
        actorLoginId: adminUsersTable.loginId,
        action: auditLogsTable.action,
        resourceType: auditLogsTable.resourceType,
        resourceId: auditLogsTable.resourceId,
        ipAddress: auditLogsTable.ipAddress,
        metadata: auditLogsTable.metadata,
        createdAt: auditLogsTable.createdAt,
      })
      .from(auditLogsTable)
      .leftJoin(adminUsersTable, eq(adminUsersTable.id, auditLogsTable.actorId))
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(auditLogsTable)
      .where(where),
  ]);
  res.json({
    items: rows.map((row) => ({
      ...row,
      actorLoginId: maskLoginId(row.actorLoginId),
      ipAddress: maskIp(row.ipAddress),
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: pagination(page, limit, Number(total)),
  });
});

router.get("/platform/system-status", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const checkedAt = new Date().toISOString();
  let database = "ok";
  let cache = redis ? "unknown" : "not_configured";
  let queue = { waiting: 0, active: 0, failed: 0, delayed: 0 };
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "error";
  }
  try {
    if (redis) {
      await connectRedis();
      cache = (await redis.ping()) === "PONG" ? "ok" : "error";
    }
    const counts = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status IN ('received', 'retry') AND next_attempt_at <= NOW()) AS waiting,
        count(*) FILTER (WHERE status = 'processing') AS active,
        count(*) FILTER (WHERE status = 'dead') AS failed,
        count(*) FILTER (WHERE status = 'retry' AND next_attempt_at > NOW()) AS delayed
      FROM payment_events
    `);
    const row = counts.rows[0] as Record<string, string | number> | undefined;
    queue = {
      waiting: Number(row?.waiting ?? 0),
      active: Number(row?.active ?? 0),
      failed: Number(row?.failed ?? 0),
      delayed: Number(row?.delayed ?? 0),
    };
  } catch {
    cache = "error";
  }
  res.json({
    checkedAt,
    api: "ok",
    database,
    cache,
    queue,
    providerEnabled: process.env.PAYMENT_PROVIDER_ENABLED === "true",
    version: process.env.APP_VERSION ?? "runtime",
  });
});

router.get("/platform/merchants/:merchantId/fees", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId) || merchantId <= 0) {
    res.status(400).json({ error: "Invalid merchant id" });
    return;
  }
  const [fees] = await db
    .select()
    .from(merchantFeeConfigsTable)
    .where(eq(merchantFeeConfigsTable.merchantId, merchantId));
  res.json({
    fees: fees
      ? {
          depositFee: fees.depositFee,
          withdrawalFee: fees.withdrawalFee,
          usageFeeRate: Number(fees.usageFeeRate),
          effectiveFrom: fees.effectiveFrom.toISOString(),
          updatedAt: fees.updatedAt.toISOString(),
        }
      : null,
  });
});

router.put("/platform/merchants/:merchantId/fees", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const merchantId = Number(req.params.merchantId);
  const depositFee = Number(req.body?.depositFee);
  const withdrawalFee = Number(req.body?.withdrawalFee);
  const usageFeeRate = Number(req.body?.usageFeeRate);
  if (
    !Number.isSafeInteger(merchantId) ||
    merchantId <= 0 ||
    !Number.isSafeInteger(depositFee) ||
    depositFee < 0 ||
    !Number.isSafeInteger(withdrawalFee) ||
    withdrawalFee < 0 ||
    !Number.isFinite(usageFeeRate) ||
    usageFeeRate < 0 ||
    usageFeeRate > 100
  ) {
    res.status(400).json({ error: "Invalid merchant fee policy" });
    return;
  }
  const [merchant] = await db
    .select({ id: merchantsTable.id })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId));
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  const [fees] = await db
    .insert(merchantFeeConfigsTable)
    .values({
      merchantId,
      depositFee,
      withdrawalFee,
      usageFeeRate: usageFeeRate.toFixed(2),
      updatedBy: caller.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: merchantFeeConfigsTable.merchantId,
      set: {
        depositFee,
        withdrawalFee,
        usageFeeRate: usageFeeRate.toFixed(2),
        effectiveFrom: new Date(),
        updatedBy: caller.id,
        updatedAt: new Date(),
      },
    })
    .returning();
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "merchant.fees.update",
    resourceType: "merchant",
    resourceId: merchantId,
    metadata: { depositFee, withdrawalFee, usageFeeRate },
  });
  res.json({
    fees: {
      depositFee: fees.depositFee,
      withdrawalFee: fees.withdrawalFee,
      usageFeeRate: Number(fees.usageFeeRate),
      effectiveFrom: fees.effectiveFrom.toISOString(),
    },
  });
});

router.patch("/platform/partner-operators/:operatorId", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const operatorId = Number(req.params.operatorId);
  const [operator] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, operatorId));
  if (!operator || operator.merchantId === null || isPlatformAdmin(operator)) {
    res.status(404).json({ error: "Partner operator not found" });
    return;
  }
  const update = {
    ...(typeof req.body?.isActive === "boolean"
      ? { isActive: req.body.isActive }
      : {}),
    ...(typeof req.body?.useOtp === "boolean"
      ? { useOtp: req.body.useOtp }
      : {}),
  };
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No operator settings supplied" });
    return;
  }
  const [updated] = await db
    .update(adminUsersTable)
    .set(update)
    .where(eq(adminUsersTable.id, operatorId))
    .returning();
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "merchant.partner_operator.update",
    resourceType: "admin_user",
    resourceId: operatorId,
    metadata: update,
  });
  res.json({
    id: updated.id,
    isActive: updated.isActive,
    useOtp: updated.useOtp,
  });
});

router.post(
  "/platform/partner-operators/:operatorId/reset-password",
  async (req, res) => {
    const caller = await requirePlatform(req, res);
    if (!caller) return;
    const operatorId = Number(req.params.operatorId);
    const password = req.body?.password;
    if (typeof password !== "string" || password.length < 12) {
      res
        .status(400)
        .json({ error: "Password must be at least 12 characters" });
      return;
    }
    const [operator] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, operatorId));
    if (
      !operator ||
      operator.merchantId === null ||
      isPlatformAdmin(operator)
    ) {
      res.status(404).json({ error: "Partner operator not found" });
      return;
    }
    await db
      .update(adminUsersTable)
      .set({
        passwordHash: await hashPassword(password),
        sessionVersion: sql`${adminUsersTable.sessionVersion} + 1`,
      })
      .where(eq(adminUsersTable.id, operatorId));
    await writeAuditLog(req, {
      actorId: caller.id,
      action: "merchant.partner_operator.password_reset",
      resourceType: "admin_user",
      resourceId: operatorId,
    });
    res.json({ success: true });
  },
);

router.get("/platform/financial-integrity", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const [latest] = await db
    .select()
    .from(reconciliationRunsTable)
    .orderBy(desc(reconciliationRunsTable.createdAt))
    .limit(1);
  const deadEvents = await db
    .select({
      id: paymentEventsTable.id,
      provider: paymentEventsTable.provider,
      eventId: paymentEventsTable.eventId,
      eventType: paymentEventsTable.eventType,
      trackingNumber: paymentEventsTable.trackingNumber,
      attemptCount: paymentEventsTable.attemptCount,
      lastError: paymentEventsTable.lastError,
      receivedAt: paymentEventsTable.receivedAt,
    })
    .from(paymentEventsTable)
    .where(eq(paymentEventsTable.status, "dead"))
    .orderBy(desc(paymentEventsTable.receivedAt))
    .limit(100);
  res.json({ latest: latest ?? null, deadEvents });
});

router.post("/platform/financial-integrity/run", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const run = await runFinancialReconciliation();
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "financial_reconciliation.run",
    resourceType: "reconciliation_run",
    resourceId: run.id,
  });
  res.status(202).json(run);
});

router.post("/platform/payment-events/:eventId/retry", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const eventId = Number(req.params.eventId);
  if (!Number.isSafeInteger(eventId)) {
    res.status(400).json({ error: "Invalid payment event ID" });
    return;
  }
  const [event] = await db.update(paymentEventsTable).set({
    status: "retry",
    nextAttemptAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
  }).where(and(
    eq(paymentEventsTable.id, eventId),
    eq(paymentEventsTable.status, "dead"),
  )).returning();
  if (!event) {
    res.status(409).json({ error: "Only dead payment events can be retried" });
    return;
  }
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "payment_event.retry",
    resourceType: "payment_event",
    resourceId: event.id,
  });
  res.status(202).json({ id: event.id, status: event.status });
});

export default router;
