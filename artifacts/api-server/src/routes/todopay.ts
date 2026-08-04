import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db, integrationMappingsTable, membersTable, transactionsTable, withdrawalsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { legacyFinancialWritesEnabled } from "../lib/integration-gate.js";
import { logger } from "../lib/logger.js";
import {
  appendFinancialScope,
  getFinancialScope,
} from "../lib/financial-scope.js";
import {
  canViewMerchantContract,
  enforceCapability,
  type Capability,
} from "../lib/access-control.js";
import {
  isTodoPayConfigured,
  requestTodoPay,
  TodoPayClientError,
} from "../lib/todopay-client.js";

const router = Router();

const queryKeys = new Set([
  "page",
  "limit",
  "search",
  "status",
  "type",
  "approvalStatus",
  "payoutStatus",
  "startDate",
  "endDate",
]);

function queryString(req: Request): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(req.query)) {
    if (!queryKeys.has(key) || typeof raw !== "string") continue;
    params.set(key, raw.slice(0, 200));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

async function requireFinancialOperator(
  req: Request,
  res: Response,
  capability: Capability = "financial.read",
) {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!enforceCapability(caller, capability, res)) return null;
  const scope = await getFinancialScope(caller);
  if (!scope.unrestricted && scope.storeCodes.length === 0) {
    res.status(403).json({
      error: "TodoPay 매장코드 연결이 필요합니다.",
      code: "FINANCIAL_SCOPE_NOT_CONFIGURED",
    });
    return null;
  }
  return { caller, scope };
}

async function forward(
  req: Request,
  res: Response,
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  capability: Capability = "financial.read",
  applyScope = true,
  merchantContractOnly = false,
) {
  const context = await requireFinancialOperator(req, res, capability);
  if (!context) return;
  const { caller, scope } = context;
  if (merchantContractOnly && !canViewMerchantContract(caller)) {
    res.status(403).json({
      error: "TodoPay 계약·연동 상세는 최고관리자와 본사만 조회할 수 있습니다.",
      code: "MERCHANT_CONTRACT_SCOPE_REQUIRED",
    });
    return;
  }
  const upstreamPath = applyScope ? appendFinancialScope(path, scope) : path;
  try {
    const payload = await requestTodoPay(upstreamPath, {
      method,
      body: method === "GET" ? undefined : req.body,
      requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
    });
    try {
      await writeAuditLog(req, {
        actorId: caller.id,
        action: `todopay.${method.toLowerCase()}`,
        resourceType: "todopay_api",
        resourceId: upstreamPath.split("?")[0],
        metadata: {
          upstreamPath: upstreamPath.split("?")[0],
          scopedStoreCount: scope.unrestricted ? null : scope.storeCodes.length,
        },
      });
    } catch (auditError) {
      logger.error(
        { err: auditError, method, upstreamPath: upstreamPath.split("?")[0], actorId: caller.id },
        "TodoPay BFF audit log could not be persisted",
      );
      if (method !== "GET") throw auditError;
    }
    res.json(payload);
  } catch (error) {
    if (error instanceof TodoPayClientError) {
      const status = error.status === 401 ? 502 : error.status;
      res.status(status).json(error.payload ?? { error: error.message });
      return;
    }
    logger.error(
      { err: error, method, upstreamPath: upstreamPath.split("?")[0], actorId: caller.id },
      "TodoPay BFF request failed",
    );
    res.status(504).json({ error: "TodoPay API 응답 시간이 초과되었습니다." });
  }
}

router.get("/todopay/status", async (req, res) => {
  const context = await requireFinancialOperator(req, res, "financial.read");
  if (!context) return;
  if (!isTodoPayConfigured()) {
    res.json({ configured: false, connected: false, message: "TodoPay API 연결정보가 설정되지 않았습니다." });
    return;
  }
  try {
    const integration = await requestTodoPay("/integration", {
      requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
    }) as Record<string, unknown>;
    const visibleIntegration = canViewMerchantContract(context.caller)
      ? integration
      : {
          paymentProviderEnabled: Boolean(integration.paymentProviderEnabled),
          checkedAt: integration.checkedAt,
        };
    res.json({ configured: true, connected: true, integration: visibleIntegration });
  } catch (error) {
    const status = error instanceof TodoPayClientError ? error.status : null;
    res.status(503).json({ configured: true, connected: false, upstreamStatus: status });
  }
});

router.get("/todopay/reconciliation", async (req, res) => {
  const context = await requireFinancialOperator(req, res, "financial.manage");
  if (!context) return;
  const { caller } = context;
  if (caller.role !== "superadmin") {
    res.status(403).json({ error: "대사 보고서는 최고관리자만 조회할 수 있습니다." });
    return;
  }
  try {
    const [
      remoteOverview,
      remoteBalance,
      [localMembers],
      [localTransactions],
      [localWithdrawals],
      [memberMappings],
    ] = await Promise.all([
      requestTodoPay("/overview") as Promise<{
        members: number;
        transactions: number;
        pendingWithdrawals: { count: number; amount: number };
        todayDeposits: number;
      }>,
      requestTodoPay("/balance") as Promise<{ availableBalance: number }>,
      db.select({ count: sql<number>`count(*)` }).from(membersTable),
      db.select({ count: sql<number>`count(*)` }).from(transactionsTable),
      db.select({ count: sql<number>`count(*)` }).from(withdrawalsTable),
      db.select({ count: sql<number>`count(*)` }).from(integrationMappingsTable)
        .where(eq(integrationMappingsTable.localEntityType, "member")),
    ]);
    res.json({
      checkedAt: new Date().toISOString(),
      legacyFinancialWritesEnabled: legacyFinancialWritesEnabled(),
      local: {
        members: Number(localMembers.count),
        transactions: Number(localTransactions.count),
        withdrawals: Number(localWithdrawals.count),
        memberMappings: Number(memberMappings.count),
      },
      todoPay: {
        members: remoteOverview.members,
        transactions: remoteOverview.transactions,
        pendingWithdrawals: remoteOverview.pendingWithdrawals,
        availableBalance: remoteBalance.availableBalance,
      },
      differences: {
        members: Number(localMembers.count) - remoteOverview.members,
        transactions: Number(localTransactions.count) - remoteOverview.transactions,
      },
      safeMode: !legacyFinancialWritesEnabled(),
    });
  } catch (error) {
    if (error instanceof TodoPayClientError) {
      res.status(503).json({ error: "대사 중 TodoPay API 호출에 실패했습니다.", upstreamStatus: error.status });
      return;
    }
    res.status(500).json({ error: "대사 보고서를 생성할 수 없습니다." });
  }
});

router.get("/todopay/overview", (req, res) => forward(req, res, "/overview"));
router.get("/todopay/merchant", (req, res) =>
  forward(req, res, "/merchant", "GET", "financial.read", false, true));
router.get("/todopay/fees", (req, res) =>
  forward(req, res, "/fees", "GET", "fees.read", false, true));
router.get("/todopay/balance", (req, res) => forward(req, res, "/balance"));
router.get("/todopay/members", (req, res) => forward(req, res, `/members${queryString(req)}`));
router.post("/todopay/members", (req, res) =>
  forward(req, res, "/members", "POST", "members.manage"));
router.patch("/todopay/members/:id", (req, res) =>
  forward(req, res, `/members/${encodeURIComponent(req.params.id)}`, "PATCH", "members.manage"));
router.get("/todopay/virtual-accounts", (req, res) =>
  forward(req, res, `/virtual-accounts${queryString(req)}`));
router.get("/todopay/transactions", (req, res) =>
  forward(req, res, `/transactions${queryString(req)}`));
router.get("/todopay/transactions/:trackingNumber", (req, res) =>
  forward(req, res, `/transactions/${encodeURIComponent(req.params.trackingNumber)}`));
router.get("/todopay/withdrawals", (req, res) =>
  forward(req, res, `/withdrawals${queryString(req)}`));
router.get("/todopay/withdrawals/:trackingNumber", (req, res) =>
  forward(req, res, `/withdrawals/${encodeURIComponent(req.params.trackingNumber)}`));
router.get("/todopay/webhook-events", (req, res) =>
  forward(req, res, `/webhook-events${queryString(req)}`));

export default router;
