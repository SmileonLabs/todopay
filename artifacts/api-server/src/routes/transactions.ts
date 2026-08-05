import { Router } from "express";
import { db, transactionsTable, membersTable, adminUsersTable, feeConfigsTable, balanceRecordsTable, storeBalancesTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte, inArray } from "drizzle-orm";
import { ListTransactionsQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";
import { requireLegacyFinancialWrites } from "../lib/integration-gate.js";
import { getAccessibleStoreIds, getStoresUnderOrg } from "../lib/query-utils.js";
import { calculateDirectFeeShares, feeAmountAtRate } from "../lib/fee-hierarchy.js";
import { enforceCapability } from "../lib/access-control.js";
import { enforceTotp } from "../lib/otp-protection.js";
import { writeAuditLog } from "../lib/audit.js";
import { parseDateBoundary, parsePositiveInteger } from "../lib/request-validation.js";

const router = Router();

interface HierarchyInfo {
  storeName: string | null;
  storeId: number;
  agencyName: string | null;
  agencyId: number | null;
  distributorName: string | null;
  distributorId: number | null;
  hqName: string | null;
  hqId: number | null;
}

/**
 * Batch-loads ancestor hierarchy for multiple stores in a single recursive CTE query.
 * Replaces the old sequential per-store approach that caused N×depth DB round trips.
 */
async function getStoreHierarchiesBatch(storeIds: number[]): Promise<Map<number, HierarchyInfo>> {
  const resultMap = new Map<number, HierarchyInfo>();
  if (storeIds.length === 0) return resultMap;

  for (const id of storeIds) {
    resultMap.set(id, {
      storeName: null, storeId: id,
      agencyName: null, agencyId: null,
      distributorName: null, distributorId: null,
      hqName: null, hqId: null,
    });
  }

  const idsSql = sql.join(storeIds.map(id => sql`${id}`), sql`, `);
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, role, parent_id, id AS origin_store_id
      FROM admin_users
      WHERE id IN (${idsSql})
      UNION ALL
      SELECT au.id, au.name, au.role, au.parent_id, a.origin_store_id
      FROM admin_users au
      JOIN ancestors a ON au.id = a.parent_id
    )
    SELECT DISTINCT origin_store_id, id, name, role FROM ancestors
  `);

  type AncestorRow = { origin_store_id: number; id: number; name: string; role: string };
  const rows = (result as unknown as { rows: AncestorRow[] }).rows;

  for (const row of rows) {
    const originId = Number(row.origin_store_id);
    const info = resultMap.get(originId);
    if (!info) continue;
    const nodeId = Number(row.id);
    if (nodeId === originId) {
      info.storeName = row.name;
    } else if (row.role === "agency") {
      info.agencyName = row.name; info.agencyId = nodeId;
    } else if (row.role === "distributor") {
      info.distributorName = row.name; info.distributorId = nodeId;
    } else if (row.role === "hq") {
      info.hqName = row.name; info.hqId = nodeId;
    }
  }

  return resultMap;
}

router.get("/transactions", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.read", res)) return;

  const parsed = ListTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const params = parsed.data;
  const page = parsePositiveInteger(params.page, 1, 1_000_000);
  const limit = parsePositiveInteger(params.limit, 20, 100);
  const startDate = parseDateBoundary(params.startDate);
  const endDate = parseDateBoundary(params.endDate, true);
  if (page === null || limit === null || startDate === null || endDate === null
    || (startDate && endDate && startDate > endDate)) {
    res.status(400).json({ error: "Invalid query parameters" }); return;
  }
  const offset = (page - 1) * limit;

  const typedParams = params as {
    storeId?: number;
    agencyId?: number;
    distributorId?: number;
    type?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  };

  const accessibleStoreIds = await getAccessibleStoreIds(caller);

  let filterStoreIds: number[] | null = null;
  if (typedParams.distributorId) {
    filterStoreIds = await getStoresUnderOrg(typedParams.distributorId);
  } else if (typedParams.agencyId) {
    filterStoreIds = await getStoresUnderOrg(typedParams.agencyId);
  } else if (typedParams.storeId) {
    filterStoreIds = [typedParams.storeId];
  }

  let effectiveStoreIds: number[] | null;
  if (accessibleStoreIds !== null && filterStoreIds !== null) {
    effectiveStoreIds = filterStoreIds.filter(id => accessibleStoreIds.includes(id));
  } else if (accessibleStoreIds !== null) {
    effectiveStoreIds = accessibleStoreIds;
  } else {
    effectiveStoreIds = filterStoreIds;
  }

  const conditions = [];

  if (effectiveStoreIds !== null) {
    if (effectiveStoreIds.length === 0) { res.json({ items: [], total: 0 }); return; }
    const storeMembers = await db.select({ id: membersTable.id })
      .from(membersTable).where(inArray(membersTable.storeId, effectiveStoreIds));
    const ids = storeMembers.map(m => m.id);
    if (ids.length === 0) { res.json({ items: [], total: 0 }); return; }
    conditions.push(inArray(transactionsTable.memberId, ids));
  }

  if (typedParams.type) conditions.push(eq(transactionsTable.type, typedParams.type));
  if (typedParams.status) conditions.push(eq(transactionsTable.status, typedParams.status));
  if (startDate) conditions.push(gte(transactionsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(transactionsTable.createdAt, endDate));
  if (typedParams.search) {
    conditions.push(or(
      ilike(transactionsTable.trackingNumber, `%${typedParams.search}%`),
      ilike(transactionsTable.fromAccount, `%${typedParams.search}%`),
      ilike(transactionsTable.toAccount, `%${typedParams.search}%`),
    )!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [txs, [{ count }]] = await Promise.all([
    db.select().from(transactionsTable).where(where).limit(limit).offset(offset).orderBy(sql`${transactionsTable.createdAt} desc`),
    db.select({ count: sql<number>`count(*)` }).from(transactionsTable).where(where),
  ]);

  const memberIds = [...new Set(txs.filter(t => t.memberId).map(t => t.memberId!))];
  const members = memberIds.length > 0
    ? await db.select().from(membersTable).where(inArray(membersTable.id, memberIds))
    : [];
  const memberMap = new Map(members.map(m => [m.id, m]));

  const uniqueStoreIds = [...new Set(members.filter(m => m.storeId).map(m => m.storeId!))];
  const hierarchyMap = await getStoreHierarchiesBatch(uniqueStoreIds);

  const formatted = txs.map((t) => {
    const member = t.memberId ? memberMap.get(t.memberId) : undefined;
    const storeId = member?.storeId ?? null;
    const hierarchy = storeId ? hierarchyMap.get(storeId) : null;
    return {
      id: t.id,
      type: t.type,
      originalAmount: Number(t.originalAmount),
      amount: Number(t.amount),
      fee: Number(t.fee),
      status: t.status,
      fromAccount: t.fromAccount,
      toAccount: t.toAccount,
      trackingNumber: t.trackingNumber,
      pgTransactionId: t.pgTransactionId,
      memberName: member?.name ?? null,
      memberId: t.memberId ?? null,
      storeName: hierarchy?.storeName ?? null,
      storeId: storeId ?? null,
      agencyName: hierarchy?.agencyName ?? null,
      agencyId: hierarchy?.agencyId ?? null,
      distributorName: hierarchy?.distributorName ?? null,
      distributorId: hierarchy?.distributorId ?? null,
      hqName: hierarchy?.hqName ?? null,
      hqId: hierarchy?.hqId ?? null,
      createdAt: t.createdAt.toISOString(),
    };
  });

  res.json({ items: formatted, total: Number(count) });
});

router.post("/transactions/:id/confirm", async (req, res) => {
  if (!requireLegacyFinancialWrites(res)) return;
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.manage", res)) return;
  if (!(await enforceTotp(caller, req, res, "sensitive"))) return;

  const txId = parseInt(req.params.id, 10);

  const [txCheck] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
  if (!txCheck) { res.status(404).json({ error: "거래를 찾을 수 없습니다" }); return; }
  if (txCheck.type !== "deposit") { res.status(400).json({ error: "입금 거래만 확인 처리할 수 있습니다" }); return; }
  if (txCheck.status !== "pending") { res.status(400).json({ error: "이미 처리된 거래입니다" }); return; }

  let member: typeof membersTable.$inferSelect | null = null;
  if (txCheck.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, txCheck.memberId));
    member = m ?? null;
  }

  if (caller.role === "store" && member) {
    if (member.storeId !== caller.id) { res.status(403).json({ error: "권한이 없습니다" }); return; }
  }

  const originalAmount = Number(txCheck.originalAmount);
  const storeId = member?.storeId ?? null;

  let depositFixedFee = 0;
  let usageFeeRate = 0;

  if (storeId) {
    const [feeConfig] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, storeId));
    if (feeConfig) {
      depositFixedFee = Number(feeConfig.depositFee);
      usageFeeRate = Number(feeConfig.usageFeeRate);
    }
  }

  const usageFeeAmount = feeAmountAtRate(originalAmount, usageFeeRate);
  const totalFeeAmount = depositFixedFee + usageFeeAmount;
  const netToStore = originalAmount - totalFeeAmount;

  const feeDistributions: Array<{ userId: number; amount: number; description: string }> = [];
  const organizationRates: Array<{ userId: number; rate: number }> = [];
  let invalidFeeAllocation: string | null = null;
  if (usageFeeAmount > 0 && storeId) {
    let currentUserId = storeId;
    const visited = new Set<number>();

    while (true) {
      if (visited.has(currentUserId)) {
        invalidFeeAllocation = "수수료 조직 구조에 순환 참조가 있습니다";
        break;
      }
      visited.add(currentUserId);

      const [currentUser] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, currentUserId));
      if (!currentUser) {
        invalidFeeAllocation = `수수료 조직 계정(${currentUserId})을 찾을 수 없습니다`;
        break;
      }

      if (!currentUser.parentId) {
        break;
      }

      const [parentUser] = await db.select().from(adminUsersTable)
        .where(eq(adminUsersTable.id, currentUser.parentId));
      if (!parentUser) {
        invalidFeeAllocation = `상위 조직 계정(${currentUser.parentId})을 찾을 수 없습니다`;
        break;
      }

      if (parentUser.role === "superadmin") break;

      const [parentFeeConfig] = await db.select().from(feeConfigsTable)
        .where(eq(feeConfigsTable.userId, parentUser.id));
      const parentRate = parentFeeConfig ? Number(parentFeeConfig.usageFeeRate) : 0;
      if (!Number.isFinite(parentRate) || parentRate < 0 || parentRate > 100) {
        invalidFeeAllocation =
          `조직 수수료율이 올바르지 않습니다: ${parentUser.name} ${parentRate}%`;
        break;
      }

      organizationRates.push({ userId: parentUser.id, rate: parentRate });
      currentUserId = parentUser.id;
    }

    if (!invalidFeeAllocation) {
      try {
        for (const share of calculateDirectFeeShares(
          originalAmount,
          usageFeeRate,
          storeId,
          organizationRates,
        )) {
          if (share.amount <= 0) continue;
          feeDistributions.push({
            userId: share.userId,
            amount: share.amount,
            description: `이용수수료 수당 [${share.userId}] - ${txCheck.trackingNumber} (배분 ${share.rate}%)`,
          });
        }
      } catch (error) {
        if (error instanceof Error && error.message === "FEE_ALLOCATION_EXCEEDS_TOTAL") {
          const allocatedRate = organizationRates.reduce((sum, item) => sum + item.rate, 0);
          invalidFeeAllocation =
            `조직 배분 합계(${allocatedRate}%)가 매장 이용수수료율(${usageFeeRate}%)을 초과합니다`;
        } else {
          throw error;
        }
      }
    }
  }

  if (invalidFeeAllocation) {
    res.status(409).json({
      error: `${invalidFeeAllocation}. 수수료 설정을 수정한 후 다시 처리해 주세요`,
    });
    return;
  }

  const distributedUsageFeeAmount = feeDistributions.reduce((sum, item) => sum + item.amount, 0);
  if (distributedUsageFeeAmount !== usageFeeAmount) {
    res.status(409).json({
      error: "수수료 배분 합계가 매장 이용 수수료와 일치하지 않아 거래를 중단했습니다",
    });
    return;
  }

  const storeUsageFeeShareAmount = storeId
    ? feeDistributions
        .filter(item => item.userId === storeId)
        .reduce((sum, item) => sum + item.amount, 0)
    : 0;
  const storeCreditAmount = netToStore + storeUsageFeeShareAmount;

  let result: { id: number; status: string } | null = null;

  await db.transaction(async (dbtx) => {
    const [updated] = await dbtx.update(transactionsTable)
      .set({
        status: "success",
        fee: totalFeeAmount.toFixed(2),
        amount: netToStore.toFixed(2),
      })
      .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.status, "pending")))
      .returning();

    if (!updated) throw new Error("ALREADY_PROCESSED");

    if (storeId && storeCreditAmount > 0) {
      await dbtx.execute(sql`
        INSERT INTO store_balances (store_id, balance, updated_at)
        VALUES (${storeId}, ${storeCreditAmount.toFixed(2)}, NOW())
        ON CONFLICT (store_id) DO UPDATE
          SET balance    = store_balances.balance + ${storeCreditAmount.toFixed(2)},
              updated_at = NOW()
      `);
    }

    for (const dist of feeDistributions) {
      await dbtx.insert(balanceRecordsTable).values({
        direction: "in",
        category: "payment",
        amount: dist.amount.toFixed(2),
        balance: "0",
        description: dist.description,
        userId: dist.userId,
      });
    }

    if (storeId) {
      await dbtx.insert(balanceRecordsTable).values({
        direction: "in",
        category: "deposit",
        amount: originalAmount.toFixed(2),
        balance: "0",
        description: `구매 확인 - ${txCheck.trackingNumber} (입금수수료 ${depositFixedFee.toLocaleString("ko-KR")}원, 이용수수료 ${usageFeeAmount.toLocaleString("ko-KR")}원, 매장 몫 ${storeUsageFeeShareAmount.toLocaleString("ko-KR")}원)`,
        userId: storeId,
      });
    }

    result = { id: updated.id, status: updated.status };
  });

  if (!result) { res.status(400).json({ error: "이미 처리된 거래입니다" }); return; }

  await writeAuditLog(req, {
    actorId: caller.id,
    action: "transaction.confirm",
    resourceType: "transaction",
    resourceId: txId,
    metadata: { storeId, originalAmount, totalFeeAmount, netToStore },
  });

  res.json({
    success: true,
    id: (result as { id: number }).id,
    status: (result as { status: string }).status,
    fee: totalFeeAmount,
    depositFixedFee,
    usageFeeAmount,
    amount: netToStore,
  });
});

export default router;
