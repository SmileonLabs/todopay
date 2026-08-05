import { Router } from "express";
import { db, balanceRecordsTable, withdrawalsTable, adminUsersTable, storeBalancesTable } from "@workspace/db";
import { eq, and, sql, gte, lte, inArray, or } from "drizzle-orm";
import { ListBalanceRecordsQueryParams, CreateBalanceRecordBody } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";
import { requireLegacyFinancialWrites } from "../lib/integration-gate.js";
import { enforceCapability } from "../lib/access-control.js";
import { enforceTotp } from "../lib/otp-protection.js";
import { writeAuditLog } from "../lib/audit.js";
import { getAccessibleStoreIds, getMemberIdsForStores } from "../lib/query-utils.js";
import { parseDateBoundary, parsePositiveInteger } from "../lib/request-validation.js";

const router = Router();

async function getRunningBalance(userId?: number): Promise<number> {
  const where = userId != null
    ? eq(balanceRecordsTable.userId, userId)
    : undefined;
  const [result] = await db.select({
    balance: sql<string>`COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)`,
  }).from(balanceRecordsTable).where(where);
  return Number(result?.balance ?? 0);
}

router.get("/balances/summary", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.read", res)) return;

  let balance: number;
  let pendingAmount: number;

  if (caller.role === "store") {
    const [sb] = await db.select().from(storeBalancesTable).where(eq(storeBalancesTable.storeId, caller.id));
    balance = sb ? Number(sb.balance) : 0;

    const [pending] = await db.select({
      amount: sql<number>`coalesce(sum(total_amount), 0)`,
    }).from(withdrawalsTable).where(and(
      eq(withdrawalsTable.storeId, caller.id),
      eq(withdrawalsTable.approvalStatus, "approved"),
      eq(withdrawalsTable.withdrawalStatus, "unpaid")
    ));
    pendingAmount = Number(pending.amount);
  } else {
    const userId = caller.role === "superadmin" ? undefined : caller.id;
    balance = await getRunningBalance(userId);
    const storeIds = await getAccessibleStoreIds(caller);
    const memberIds = storeIds !== null && storeIds.length > 0
      ? (await getMemberIdsForStores(storeIds)) ?? []
      : [];
    const pendingScope = storeIds === null
      ? undefined
      : storeIds.length === 0
        ? sql`false`
        : memberIds.length > 0
          ? or(
              inArray(withdrawalsTable.storeId, storeIds),
              inArray(withdrawalsTable.memberId, memberIds),
            )
          : inArray(withdrawalsTable.storeId, storeIds);
    const [pending] = await db.select({
      amount: sql<number>`coalesce(sum(total_amount), 0)`,
    }).from(withdrawalsTable).where(and(
      pendingScope,
      eq(withdrawalsTable.approvalStatus, "approved"),
      eq(withdrawalsTable.withdrawalStatus, "unpaid")
    ));
    pendingAmount = Number(pending.amount);
  }

  res.json({ balance, pendingAmount });
});

router.get("/balances", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.read", res)) return;

  const parsed = ListBalanceRecordsQueryParams.safeParse(req.query);
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

  const conditions = [];
  if (caller.role !== "superadmin") {
    conditions.push(eq(balanceRecordsTable.userId, caller.id));
  }
  if (params.type) conditions.push(eq(balanceRecordsTable.direction, params.type));
  if (startDate) conditions.push(gte(balanceRecordsTable.createdAt, startDate));
  if (endDate) conditions.push(lte(balanceRecordsTable.createdAt, endDate));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [records, [{ count }]] = await Promise.all([
    db.select().from(balanceRecordsTable).where(where).limit(limit).offset(offset).orderBy(sql`created_at desc`),
    db.select({ count: sql<number>`count(*)` }).from(balanceRecordsTable).where(where),
  ]);

  res.json({
    items: records.map(r => ({
      id: r.id,
      direction: r.direction,
      category: r.category,
      amount: Number(r.amount),
      balance: Number(r.balance),
      description: r.description ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total: Number(count),
  });
});

router.post("/balances", async (req, res) => {
  if (!requireLegacyFinancialWrites(res)) return;
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.manage", res)) return;
  if (!(await enforceTotp(caller, req, res, "sensitive"))) return;

  if (caller.role !== "superadmin") {
    res.status(403).json({ error: "잔액 수동 입력은 최고관리자만 가능합니다" }); return;
  }

  const parsed = CreateBalanceRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { direction, category, amount, description } = parsed.data;

  if (!["in", "out"].includes(direction)) {
    res.status(400).json({ error: "direction은 'in' 또는 'out'이어야 합니다" }); return;
  }

  const record = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73002, 1)`);
    const [result] = await tx.select({
      balance: sql<string>`COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)`,
    }).from(balanceRecordsTable);
    const previousBalance = Number(result?.balance ?? 0);
    const nextBalance = direction === "in"
      ? previousBalance + amount
      : previousBalance - amount;
    const [inserted] = await tx.insert(balanceRecordsTable).values({
      userId: null,
      direction,
      category,
      amount: amount.toFixed(2),
      balance: nextBalance.toFixed(2),
      description: description?.trim() || null,
    }).returning();
    return inserted;
  });

  await writeAuditLog(req, {
    actorId: caller.id,
    action: "balance.manual_entry",
    resourceType: "balance_record",
    resourceId: record.id,
    metadata: { direction, category, amount },
  });

  res.status(201).json({
    id: record.id,
    direction: record.direction,
    category: record.category,
    amount: Number(record.amount),
    balance: Number(record.balance),
    description: record.description ?? null,
    createdAt: record.createdAt.toISOString(),
  });
});

export default router;
