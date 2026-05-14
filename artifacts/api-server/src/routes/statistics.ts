import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, withdrawalsTable, adminUsersTable } from "@workspace/db";
import { eq, sql, gte, lte, and, inArray } from "drizzle-orm";
import { GetDailyStatisticsQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

async function getAccessibleStoreIds(caller: typeof adminUsersTable.$inferSelect): Promise<number[] | null> {
  if (caller.role === "superadmin") return null;
  if (caller.role === "store") return [caller.id];
  const result = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, role FROM admin_users WHERE id = ${caller.id}
      UNION ALL
      SELECT au.id, au.role FROM admin_users au
      JOIN descendants d ON au.parent_id = d.id
    )
    SELECT id FROM descendants WHERE role = 'store'
  `);
  return (result as unknown as { rows: Array<{ id: number }> }).rows.map(r => Number(r.id));
}

router.get("/statistics/overview", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const storeIds = await getAccessibleStoreIds(caller);

  const memberIds = storeIds !== null
    ? (await db.select({ id: membersTable.id }).from(membersTable).where(inArray(membersTable.storeId, storeIds))).map(m => m.id)
    : null;

  const txFilter = (extra: ReturnType<typeof and>) =>
    memberIds !== null
      ? and(extra, memberIds.length > 0 ? inArray(transactionsTable.memberId, memberIds) : sql`false`)
      : extra;

  const wdFilter = (extra: ReturnType<typeof and>) =>
    storeIds !== null
      ? and(extra, storeIds.length > 0 ? inArray(withdrawalsTable.storeId, storeIds) : sql`false`)
      : extra;

  const [todayDeposit] = await db.select({ amount: sql<number>`coalesce(sum(original_amount), 0)` })
    .from(transactionsTable)
    .where(txFilter(and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, todayStart))));
  const [todayWithdrawal] = await db.select({ amount: sql<number>`coalesce(sum(amount), 0)` })
    .from(withdrawalsTable)
    .where(wdFilter(and(gte(withdrawalsTable.createdAt, todayStart), sql`approval_status != 'rejected'`)));
  const [todayFee] = await db.select({ amount: sql<number>`coalesce(sum(fee), 0)` })
    .from(transactionsTable)
    .where(txFilter(and(eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, todayStart))));
  const [monthDeposit] = await db.select({ amount: sql<number>`coalesce(sum(original_amount), 0)` })
    .from(transactionsTable)
    .where(txFilter(and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, monthStart))));
  const [monthWithdrawal] = await db.select({ amount: sql<number>`coalesce(sum(amount), 0)` })
    .from(withdrawalsTable)
    .where(wdFilter(and(gte(withdrawalsTable.createdAt, monthStart), sql`approval_status != 'rejected'`)));

  const memberWhere = storeIds !== null
    ? (storeIds.length > 0 ? inArray(membersTable.storeId, storeIds) : sql`false`)
    : undefined;
  const vaWhere = memberIds !== null
    ? and(eq(virtualAccountsTable.status, "active"), memberIds.length > 0 ? inArray(virtualAccountsTable.memberId, memberIds) : sql`false`)
    : eq(virtualAccountsTable.status, "active");
  const pendingWhere = storeIds !== null
    ? and(eq(withdrawalsTable.approvalStatus, "pending"), storeIds.length > 0 ? inArray(withdrawalsTable.storeId, storeIds) : sql`false`)
    : eq(withdrawalsTable.approvalStatus, "pending");

  const [totalMembers] = await db.select({ count: sql<number>`count(*)` }).from(membersTable).where(memberWhere);
  const [activeVA] = await db.select({ count: sql<number>`count(*)` }).from(virtualAccountsTable).where(vaWhere);
  const [pendingW] = await db.select({ count: sql<number>`count(*)` }).from(withdrawalsTable).where(pendingWhere);

  res.json({
    todayDeposit: Number(todayDeposit.amount),
    todayWithdrawal: Number(todayWithdrawal.amount),
    todayFee: Number(todayFee.amount),
    monthDeposit: Number(monthDeposit.amount),
    monthWithdrawal: Number(monthWithdrawal.amount),
    totalMembers: Number(totalMembers.count),
    activeVirtualAccounts: Number(activeVA.count),
    pendingWithdrawals: Number(pendingW.count),
  });
});

router.get("/statistics/daily", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = GetDailyStatisticsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};

  const startDate = params.startDate
    ? new Date(params.startDate + "T00:00:00.000Z")
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const endDate = params.endDate
    ? new Date(params.endDate + "T23:59:59.999Z")
    : new Date();

  const storeIds = await getAccessibleStoreIds(caller);

  const memberIds = storeIds !== null
    ? (await db.select({ id: membersTable.id }).from(membersTable).where(inArray(membersTable.storeId, storeIds))).map(m => m.id)
    : null;

  const baseRange = and(gte(transactionsTable.createdAt, startDate), lte(transactionsTable.createdAt, endDate), eq(transactionsTable.status, "success"));
  const txWhere = memberIds !== null
    ? and(baseRange, memberIds.length > 0 ? inArray(transactionsTable.memberId, memberIds) : sql`false`)
    : baseRange;

  const wdRange = and(gte(withdrawalsTable.createdAt, startDate), lte(withdrawalsTable.createdAt, endDate), sql`approval_status != 'rejected'`);
  const wdWhere = storeIds !== null
    ? and(wdRange, storeIds.length > 0 ? inArray(withdrawalsTable.storeId, storeIds) : sql`false`)
    : wdRange;

  const [txs, wds] = await Promise.all([
    db.select().from(transactionsTable).where(txWhere),
    db.select().from(withdrawalsTable).where(wdWhere),
  ]);

  const byDate = new Map<string, {
    depositCount: number;
    depositAmount: number;
    depositOriginalAmount: number;
    withdrawalCount: number;
    withdrawalAmount: number;
    feeAmount: number;
  }>();

  const ensureDate = (date: string) => {
    if (!byDate.has(date)) {
      byDate.set(date, {
        depositCount: 0,
        depositAmount: 0,
        depositOriginalAmount: 0,
        withdrawalCount: 0,
        withdrawalAmount: 0,
        feeAmount: 0,
      });
    }
    return byDate.get(date)!;
  };

  for (const t of txs) {
    const date = t.createdAt.toISOString().split("T")[0];
    const d = ensureDate(date);
    d.depositCount++;
    d.depositAmount += Number(t.amount);
    d.depositOriginalAmount += Number(t.originalAmount);
    d.feeAmount += Number(t.fee);
  }

  for (const w of wds) {
    const date = w.createdAt.toISOString().split("T")[0];
    const d = ensureDate(date);
    d.withdrawalCount++;
    d.withdrawalAmount += Number(w.amount);
  }

  const result = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      depositCount: d.depositCount,
      depositAmount: d.depositOriginalAmount,
      withdrawalCount: d.withdrawalCount,
      withdrawalAmount: d.withdrawalAmount,
      feeAmount: d.feeAmount,
      netAmount: d.depositAmount - d.withdrawalAmount,
    }));

  res.json(result);
});

export default router;
