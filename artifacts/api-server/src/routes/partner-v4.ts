import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import {
  db,
  feeConfigsTable,
  membersTable,
  merchantFeeConfigsTable,
  merchantWebhookDeliveriesTable,
  merchantsTable,
  paymentEventsTable,
  transactionsTable,
  virtualAccountIssuancesTable,
  virtualAccountsTable,
  withdrawalsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  escapeLike,
  maskAccount,
  maskEmail,
  maskLoginId,
  maskName,
  maskPhone,
} from "../lib/partner-payment-view.js";
import { deriveMerchantWebhookSecret } from "../lib/merchant-webhook-signing.js";

const router = Router();

function buildIntegrationStage(params: {
  status: string;
  apiKeyIssued: boolean;
  allowedIpCount: number;
  webhookConfigured: boolean;
  paymentProviderEnabled: boolean;
}) {
  const {
    status,
    apiKeyIssued,
    allowedIpCount,
    webhookConfigured,
    paymentProviderEnabled,
  } = params;

  if (status !== "active") return status;
  if (!apiKeyIssued) return "draft";
  if (allowedIpCount === 0) return "integration_pending";
  if (!webhookConfigured) return "test_ready";
  return paymentProviderEnabled ? "live" : "test_ready";
}

function buildChecklist(params: {
  merchantActive: boolean;
  apiKeyIssued: boolean;
  allowedIpCount: number;
  webhookConfigured: boolean;
  paymentProviderEnabled: boolean;
}) {
  return [
    {
      key: "merchant_active",
      label: "가맹점 활성 상태",
      done: params.merchantActive,
      required: true,
    },
    {
      key: "api_key",
      label: "API 키 발급",
      done: params.apiKeyIssued,
      required: true,
    },
    {
      key: "allowed_ips",
      label: "허용 IP 등록",
      done: params.allowedIpCount > 0,
      required: true,
    },
    {
      key: "webhook_url",
      label: "Webhook URL 등록",
      done: params.webhookConfigured,
      required: true,
    },
    {
      key: "payment_provider",
      label: "PG 연동 활성화",
      done: params.paymentProviderEnabled,
      required: false,
    },
  ];
}

function buildWarnings(params: {
  merchantActive: boolean;
  apiKeyIssued: boolean;
  allowedIpCount: number;
  webhookConfigured: boolean;
  paymentProviderEnabled: boolean;
}) {
  return [
    ...(params.merchantActive
      ? []
      : ["가맹점 상태가 active가 아니어서 운영 연동이 차단됩니다."]),
    ...(params.apiKeyIssued ? [] : ["API 키가 아직 발급되지 않았습니다."]),
    ...(params.allowedIpCount > 0
      ? []
      : ["허용 IP가 등록되지 않아 외부 API 호출이 차단됩니다."]),
    ...(params.webhookConfigured
      ? []
      : [
          "Webhook URL이 미설정 상태입니다. 입금/출금 이벤트 수신을 위해 등록이 필요합니다.",
        ]),
    ...(params.paymentProviderEnabled
      ? []
      : ["현재 PG 연동은 비활성 상태입니다. 테스트 준비 단계로 간주합니다."]),
  ];
}

async function requirePartner(req: Request, res: Response) {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (!caller.merchantId) {
    res.status(403).json({ error: "Merchant portal account required" });
    return null;
  }

  const [merchant] = await db
    .select()
    .from(merchantsTable)
    .where(eq(merchantsTable.id, caller.merchantId));
  if (!merchant || merchant.status !== "active") {
    res.status(403).json({ error: "Active merchant required" });
    return null;
  }

  return { caller, merchant };
}

router.get("/partner/overview", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const merchantId = context.merchant.id;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    [{ transactionCount }],
    [{ withdrawalCount }],
    [{ memberCount }],
    [{ activeVirtualAccounts }],
    [{ awaitingVerificationCount }],
    [{ issuedVirtualAccountCount }],
    [{ recentWebhookEvents }],
    [{ deliveredWebhookCount }],
    [{ failedWebhookCount }],
    [{ todayDepositAmount }],
    [legacyFeeConfig],
    [merchantFeeConfig],
  ] = await Promise.all([
    db
      .select({ transactionCount: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(eq(transactionsTable.merchantId, merchantId)),
    db
      .select({ withdrawalCount: sql<number>`count(*)` })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.merchantId, merchantId)),
    db
      .select({ memberCount: sql<number>`count(*)` })
      .from(membersTable)
      .where(eq(membersTable.merchantId, merchantId)),
    db
      .select({ activeVirtualAccounts: sql<number>`count(*)` })
      .from(virtualAccountsTable)
      .where(
        and(
          eq(virtualAccountsTable.merchantId, merchantId),
          eq(virtualAccountsTable.status, "active"),
        ),
      ),
    db
      .select({ awaitingVerificationCount: sql<number>`count(*)` })
      .from(virtualAccountIssuancesTable)
      .where(
        and(
          eq(virtualAccountIssuancesTable.merchantId, merchantId),
          eq(virtualAccountIssuancesTable.status, "awaiting_verification"),
        ),
      ),
    db
      .select({ issuedVirtualAccountCount: sql<number>`count(*)` })
      .from(virtualAccountIssuancesTable)
      .where(
        and(
          eq(virtualAccountIssuancesTable.merchantId, merchantId),
          eq(virtualAccountIssuancesTable.status, "issued"),
        ),
      ),
    db
      .select({ recentWebhookEvents: sql<number>`count(*)` })
      .from(paymentEventsTable)
      .where(
        and(
          eq(paymentEventsTable.merchantId, merchantId),
          gte(paymentEventsTable.processedAt, startOfToday),
        ),
      ),
    db
      .select({ deliveredWebhookCount: sql<number>`count(*)` })
      .from(merchantWebhookDeliveriesTable)
      .where(
        and(
          eq(merchantWebhookDeliveriesTable.merchantId, merchantId),
          eq(merchantWebhookDeliveriesTable.status, "delivered"),
        ),
      ),
    db
      .select({ failedWebhookCount: sql<number>`count(*)` })
      .from(merchantWebhookDeliveriesTable)
      .where(
        and(
          eq(merchantWebhookDeliveriesTable.merchantId, merchantId),
          eq(merchantWebhookDeliveriesTable.status, "dead"),
        ),
      ),
    db
      .select({
        todayDepositAmount: sql<number>`coalesce(sum(${transactionsTable.amount}), 0)`,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.merchantId, merchantId),
          eq(transactionsTable.type, "deposit"),
          gte(transactionsTable.createdAt, startOfToday),
        ),
      ),
    db
      .select()
      .from(feeConfigsTable)
      .where(eq(feeConfigsTable.userId, context.caller.id))
      .limit(1),
    db
      .select()
      .from(merchantFeeConfigsTable)
      .where(eq(merchantFeeConfigsTable.merchantId, merchantId))
      .limit(1),
  ]);

  const apiKeyIssued = Boolean(
    context.merchant.apiKeyHash && context.merchant.apiKeyPrefix,
  );
  const allowedIpCount = context.merchant.allowedIps?.length ?? 0;
  const webhookConfigured = Boolean(context.merchant.webhookUrl);
  const paymentProviderEnabled =
    process.env.PAYMENT_PROVIDER_ENABLED === "true";
  const merchantActive = context.merchant.status === "active";

  res.json({
    merchant: {
      id: context.merchant.id,
      code: context.merchant.code,
      name: context.merchant.name,
      status: context.merchant.status,
      adminDomain: context.merchant.adminDomain,
      webhookUrl: context.merchant.webhookUrl,
      allowedIps: context.merchant.allowedIps ?? [],
      apiKeyPrefix: context.merchant.apiKeyPrefix,
      dailyWithdrawalLimit: context.merchant.dailyWithdrawalLimit,
      integrationStage: buildIntegrationStage({
        status: context.merchant.status,
        apiKeyIssued,
        allowedIpCount,
        webhookConfigured,
        paymentProviderEnabled,
      }),
    },
    integration: {
      apiKeyIssued,
      allowedIpCount,
      webhookConfigured,
      externalApiReady: merchantActive && apiKeyIssued && allowedIpCount > 0,
      paymentProviderEnabled,
      oneWonVerificationEnabled: paymentProviderEnabled,
      virtualAccountEnabled: paymentProviderEnabled,
      payoutEnabled: paymentProviderEnabled,
      checklist: buildChecklist({
        merchantActive,
        apiKeyIssued,
        allowedIpCount,
        webhookConfigured,
        paymentProviderEnabled,
      }),
      warnings: buildWarnings({
        merchantActive,
        apiKeyIssued,
        allowedIpCount,
        webhookConfigured,
        paymentProviderEnabled,
      }),
    },
    summary: {
      memberCount: Number(memberCount),
      transactionCount: Number(transactionCount),
      withdrawalCount: Number(withdrawalCount),
      activeVirtualAccounts: Number(activeVirtualAccounts),
      awaitingVerificationCount: Number(awaitingVerificationCount),
      issuedVirtualAccountCount: Number(issuedVirtualAccountCount),
      recentWebhookEvents: Number(recentWebhookEvents),
      deliveredWebhookCount: Number(deliveredWebhookCount),
      failedWebhookCount: Number(failedWebhookCount),
      todayDepositAmount: Number(todayDepositAmount),
    },
    fees:
      (merchantFeeConfig ?? legacyFeeConfig)
        ? {
            configured: true,
            depositFee: Number(
              (merchantFeeConfig ?? legacyFeeConfig)!.depositFee,
            ),
            withdrawalFee: Number(
              (merchantFeeConfig ?? legacyFeeConfig)!.withdrawalFee,
            ),
            usageFeeRate: Number(
              (merchantFeeConfig ?? legacyFeeConfig)!.usageFeeRate,
            ),
          }
        : {
            configured: false,
            depositFee: null,
            withdrawalFee: null,
            usageFeeRate: null,
          },
  });
});

router.get("/partner/activity", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const merchantId = context.merchant.id;
  const [events, recentWithdrawals, recentTransactions] = await Promise.all([
    db
      .select({
        provider: paymentEventsTable.provider,
        eventType: paymentEventsTable.eventType,
        trackingNumber: paymentEventsTable.trackingNumber,
        processedAt: paymentEventsTable.processedAt,
      })
      .from(paymentEventsTable)
      .where(eq(paymentEventsTable.merchantId, merchantId))
      .orderBy(desc(paymentEventsTable.processedAt))
      .limit(10),
    db
      .select({
        trackingNumber: withdrawalsTable.trackingNumber,
        status: withdrawalsTable.withdrawalStatus,
        amount: withdrawalsTable.amount,
        updatedAt: withdrawalsTable.providerUpdatedAt,
        createdAt: withdrawalsTable.createdAt,
      })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.merchantId, merchantId))
      .orderBy(desc(withdrawalsTable.createdAt))
      .limit(10),
    db
      .select({
        trackingNumber: transactionsTable.trackingNumber,
        status: transactionsTable.status,
        amount: transactionsTable.amount,
        processedAt: transactionsTable.processedAt,
        createdAt: transactionsTable.createdAt,
      })
      .from(transactionsTable)
      .where(eq(transactionsTable.merchantId, merchantId))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(10),
  ]);

  res.json({
    webhookEvents: events.map((event) => ({
      provider: event.provider,
      eventType: event.eventType,
      trackingNumber: event.trackingNumber,
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
    recentWithdrawals: recentWithdrawals.map((item) => ({
      trackingNumber: item.trackingNumber,
      status: item.status,
      amount: Number(item.amount),
      updatedAt: item.updatedAt?.toISOString() ?? item.createdAt.toISOString(),
    })),
    recentTransactions: recentTransactions.map((item) => ({
      trackingNumber: item.trackingNumber,
      status: item.status,
      amount: Number(item.amount),
      updatedAt:
        item.processedAt?.toISOString() ?? item.createdAt.toISOString(),
    })),
  });
});

const PAYMENT_STATUSES = new Set([
  "received",
  "processing",
  "pending",
  "success",
  "failed",
]);

function parseDate(value: unknown, endOfDay = false) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

router.get("/partner/payments", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const page = Math.max(
    1,
    Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
  );
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20),
  );
  const offset = (page - 1) * limit;
  const status =
    typeof req.query.status === "string" &&
    PAYMENT_STATUSES.has(req.query.status)
      ? req.query.status
      : null;
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
  if (req.query.startDate && !startDate) {
    res.status(400).json({ error: "Invalid start date" });
    return;
  }
  if (req.query.endDate && !endDate) {
    res.status(400).json({ error: "Invalid end date" });
    return;
  }
  if (startDate && endDate && startDate > endDate) {
    res.status(400).json({ error: "Start date must not be after end date" });
    return;
  }

  const conditions = [
    eq(transactionsTable.merchantId, context.merchant.id),
    eq(transactionsTable.type, "deposit"),
  ];
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
      )!,
    );
  }

  const where = and(...conditions);
  const [payments, [{ total }]] = await Promise.all([
    db
      .select({
        id: transactionsTable.id,
        trackingNumber: transactionsTable.trackingNumber,
        pgTransactionId: transactionsTable.pgTransactionId,
        status: transactionsTable.status,
        originalAmount: transactionsTable.originalAmount,
        amount: transactionsTable.amount,
        fee: transactionsTable.fee,
        fromAccount: transactionsTable.fromAccount,
        toAccount: transactionsTable.toAccount,
        processedAt: transactionsTable.processedAt,
        createdAt: transactionsTable.createdAt,
        memberId: membersTable.id,
        memberLoginId: membersTable.loginId,
        memberName: membersTable.name,
      })
      .from(transactionsTable)
      .leftJoin(
        membersTable,
        and(
          eq(membersTable.id, transactionsTable.memberId),
          eq(membersTable.merchantId, context.merchant.id),
        ),
      )
      .where(where)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(transactionsTable)
      .leftJoin(
        membersTable,
        and(
          eq(membersTable.id, transactionsTable.memberId),
          eq(membersTable.merchantId, context.merchant.id),
        ),
      )
      .where(where),
  ]);

  res.json({
    items: payments.map((payment) => ({
      id: payment.id,
      trackingNumber: payment.trackingNumber,
      pgTransactionId: payment.pgTransactionId,
      status: payment.status,
      paymentAmount: Number(payment.originalAmount),
      fee: Number(payment.fee),
      settlementAmount: Number(payment.amount),
      fromAccount: maskAccount(payment.fromAccount),
      toAccount: maskAccount(payment.toAccount),
      member: payment.memberId
        ? {
            id: payment.memberId,
            loginId: maskLoginId(payment.memberLoginId),
            name: maskName(payment.memberName),
          }
        : null,
      requestedAt: payment.createdAt.toISOString(),
      completedAt: payment.processedAt?.toISOString() ?? null,
    })),
    pagination: {
      page,
      limit,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / limit)),
    },
  });
});

router.get("/partner/payments/:id", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const paymentId = Number.parseInt(req.params.id, 10);
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
      amount: transactionsTable.amount,
      fee: transactionsTable.fee,
      fromAccount: transactionsTable.fromAccount,
      toAccount: transactionsTable.toAccount,
      processedAt: transactionsTable.processedAt,
      createdAt: transactionsTable.createdAt,
      memberId: membersTable.id,
      memberLoginId: membersTable.loginId,
      memberName: membersTable.name,
      memberPhone: membersTable.phone,
      memberEmail: membersTable.email,
    })
    .from(transactionsTable)
    .leftJoin(
      membersTable,
      and(
        eq(membersTable.id, transactionsTable.memberId),
        eq(membersTable.merchantId, context.merchant.id),
      ),
    )
    .where(
      and(
        eq(transactionsTable.id, paymentId),
        eq(transactionsTable.merchantId, context.merchant.id),
        eq(transactionsTable.type, "deposit"),
      ),
    )
    .limit(1);

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const [events, virtualAccounts] = await Promise.all([
    db
      .select({
        provider: paymentEventsTable.provider,
        eventType: paymentEventsTable.eventType,
        eventId: paymentEventsTable.eventId,
        processedAt: paymentEventsTable.processedAt,
      })
      .from(paymentEventsTable)
      .where(
        and(
          eq(paymentEventsTable.merchantId, context.merchant.id),
          eq(paymentEventsTable.trackingNumber, payment.trackingNumber),
        ),
      )
      .orderBy(desc(paymentEventsTable.processedAt))
      .limit(50),
    db
      .select({
        bankName: virtualAccountsTable.bankName,
        accountNumber: virtualAccountsTable.accountNumber,
        status: virtualAccountsTable.status,
        createdAt: virtualAccountsTable.createdAt,
      })
      .from(virtualAccountsTable)
      .where(
        and(
          eq(virtualAccountsTable.merchantId, context.merchant.id),
          or(
            eq(virtualAccountsTable.accountNumber, payment.fromAccount),
            eq(virtualAccountsTable.accountNumber, payment.toAccount),
          ),
        ),
      )
      .orderBy(desc(virtualAccountsTable.createdAt))
      .limit(1),
  ]);

  await writeAuditLog(req, {
    actorId: context.caller.id,
    action: "partner.payment.read",
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
    member: payment.memberId
      ? {
          id: payment.memberId,
          loginId: maskLoginId(payment.memberLoginId),
          name: maskName(payment.memberName),
          phone: maskPhone(payment.memberPhone),
          email: maskEmail(payment.memberEmail),
        }
      : null,
    virtualAccount: virtualAccounts[0]
      ? {
          bankName: virtualAccounts[0].bankName,
          accountNumber: maskAccount(virtualAccounts[0].accountNumber),
          status: virtualAccounts[0].status,
          createdAt: virtualAccounts[0].createdAt.toISOString(),
        }
      : null,
    events: events.map((event) => ({
      provider: event.provider,
      eventType: event.eventType,
      eventId: event.eventId,
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
  });
});

router.patch("/partner/settings", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const body = req.body ?? {};
  const webhookUrl =
    typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : undefined;
  const allowedIps = Array.isArray(body.allowedIps)
    ? body.allowedIps.filter(
        (value: unknown): value is string =>
          typeof value === "string" && /^[0-9a-fA-F:.\/]{1,64}$/.test(value),
      )
    : undefined;

  if (
    webhookUrl !== undefined &&
    webhookUrl !== "" &&
    !/^https:\/\//i.test(webhookUrl)
  ) {
    res.status(400).json({ error: "Webhook URL must use HTTPS" });
    return;
  }

  if (webhookUrl === undefined && allowedIps === undefined) {
    res.status(400).json({ error: "No settings supplied" });
    return;
  }

  const updated = await db.transaction(async (txdb) => {
    const [merchant] = await txdb
      .update(merchantsTable)
      .set({
        ...(webhookUrl !== undefined ? { webhookUrl: webhookUrl || null } : {}),
        ...(allowedIps !== undefined ? { allowedIps } : {}),
        updatedAt: new Date(),
      })
      .where(eq(merchantsTable.id, context.merchant.id))
      .returning();

    if (webhookUrl) {
      await txdb
        .update(merchantWebhookDeliveriesTable)
        .set({
          status: "retry",
          nextAttemptAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              merchantWebhookDeliveriesTable.merchantId,
              context.merchant.id,
            ),
            or(
              eq(merchantWebhookDeliveriesTable.status, "retry"),
              eq(merchantWebhookDeliveriesTable.status, "dead"),
            ),
          ),
        );
    }
    return merchant;
  });

  await writeAuditLog(req, {
    actorId: context.caller.id,
    action: "partner.settings.update",
    resourceType: "merchant",
    resourceId: updated.id,
  });

  res.json({
    webhookUrl: updated.webhookUrl,
    allowedIps: updated.allowedIps ?? [],
  });
});

router.get("/partner/webhook-deliveries", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
  );
  const deliveries = await db
    .select({
      eventId: merchantWebhookDeliveriesTable.eventId,
      eventType: merchantWebhookDeliveriesTable.eventType,
      status: merchantWebhookDeliveriesTable.status,
      attemptCount: merchantWebhookDeliveriesTable.attemptCount,
      responseStatus: merchantWebhookDeliveriesTable.responseStatus,
      lastError: merchantWebhookDeliveriesTable.lastError,
      lastAttemptAt: merchantWebhookDeliveriesTable.lastAttemptAt,
      deliveredAt: merchantWebhookDeliveriesTable.deliveredAt,
      createdAt: merchantWebhookDeliveriesTable.createdAt,
    })
    .from(merchantWebhookDeliveriesTable)
    .where(
      eq(merchantWebhookDeliveriesTable.merchantId, context.merchant.id),
    )
    .orderBy(desc(merchantWebhookDeliveriesTable.createdAt))
    .limit(limit);

  res.json({
    webhookUrl: context.merchant.webhookUrl,
    secretVersion: context.merchant.webhookSecretVersion,
    items: deliveries.map((delivery) => ({
      ...delivery,
      lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
  });
});

router.post("/partner/webhook-test", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;
  if (!context.merchant.webhookUrl) {
    res.status(409).json({ error: "Webhook URL must be configured first" });
    return;
  }

  const eventId = `tdp_evt_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await db.insert(merchantWebhookDeliveriesTable).values({
    eventId,
    merchantId: context.merchant.id,
    eventType: "webhook.test",
    payload: {
      id: eventId,
      type: "webhook.test",
      createdAt: new Date().toISOString(),
      data: {
        message: "TodoPay webhook connection test",
        merchantCode: context.merchant.code,
      },
    },
  });
  await writeAuditLog(req, {
    actorId: context.caller.id,
    action: "partner.webhook.test",
    resourceType: "merchant_webhook_delivery",
    resourceId: eventId,
  });
  res.status(202).json({ eventId, status: "pending" });
});

router.post("/partner/webhook-secret/rotate", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const masterSecret = process.env.WEBHOOK_MASTER_SECRET ?? "";
  if (masterSecret.length < 32) {
    res.status(503).json({ error: "Webhook signing is not configured" });
    return;
  }

  const updated = await db.transaction(async (txdb) => {
    const [merchant] = await txdb
      .update(merchantsTable)
      .set({
        webhookSecretVersion: sql`${merchantsTable.webhookSecretVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(merchantsTable.id, context.merchant.id))
      .returning();
    await txdb
      .update(merchantWebhookDeliveriesTable)
      .set({
        status: "retry",
        nextAttemptAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantWebhookDeliveriesTable.merchantId, context.merchant.id),
          or(
            eq(merchantWebhookDeliveriesTable.status, "retry"),
            eq(merchantWebhookDeliveriesTable.status, "dead"),
          ),
        ),
      );
    return merchant;
  });

  const webhookSecret = deriveMerchantWebhookSecret(
    masterSecret,
    updated.code,
    updated.webhookSecretVersion,
  );
  await writeAuditLog(req, {
    actorId: context.caller.id,
    action: "partner.webhook_secret.rotate",
    resourceType: "merchant",
    resourceId: updated.id,
    metadata: { version: updated.webhookSecretVersion },
  });
  res.json({
    webhookSecret,
    secretVersion: updated.webhookSecretVersion,
    warning: "This secret is shown only in this response. Store it securely.",
  });
});

router.post("/partner/api-key/rotate", async (req, res) => {
  const context = await requirePartner(req, res);
  if (!context) return;

  const rawKey = `tp_live_${crypto.randomBytes(32).toString("base64url")}`;
  const apiKeyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  const [updated] = await db
    .update(merchantsTable)
    .set({
      apiKeyHash,
      apiKeyPrefix: rawKey.slice(0, 14),
      updatedAt: new Date(),
    })
    .where(eq(merchantsTable.id, context.merchant.id))
    .returning();

  await writeAuditLog(req, {
    actorId: context.caller.id,
    action: "partner.api_key.rotate",
    resourceType: "merchant",
    resourceId: updated.id,
  });

  res.json({ apiKey: rawKey, apiKeyPrefix: updated.apiKeyPrefix });
});

export default router;
