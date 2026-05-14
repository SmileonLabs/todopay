import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, withdrawalsTable } from "@workspace/db";
import { eq, sql, gte, lte, and } from "drizzle-orm";
import { GetDailyStatisticsQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

router.get("/statistics/overview", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const [todayDeposit] = await db.select({ amount: sql<number>`coalesce(sum(original_amount), 0)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, todayStart)));
  const [todayWithdrawal] = await db.select({ amount: sql<number>`coalesce(sum(amount), 0)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.type, "withdrawal"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, todayStart)));
  const [todayFee] = await db.select({ amount: sql<number>`coalesce(sum(fee), 0)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, todayStart)));
  const [monthDeposit] = await db.select({ amount: sql<number>`coalesce(sum(original_amount), 0)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, monthStart)));
  const [monthWithdrawal] = await db.select({ amount: sql<number>`coalesce(sum(amount), 0)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.type, "withdrawal"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, monthStart)));
  const [totalMembers] = await db.select({ count: sql<number>`count(*)` }).from(membersTable);
  const [activeVA] = await db.select({ count: sql<number>`count(*)` }).from(virtualAccountsTable).where(eq(virtualAccountsTable.status, "active"));
  const [pendingW] = await db.select({ count: sql<number>`count(*)` }).from(withdrawalsTable).where(eq(withdrawalsTable.approvalStatus, "pending"));

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

  const conditions = [
    gte(transactionsTable.createdAt, startDate),
    lte(transactionsTable.createdAt, endDate),
    eq(transactionsTable.status, "success"),
  ];
  const txs = await db.select().from(transactionsTable).where(and(...conditions));

  const byDate = new Map<string, {
    depositCount: number;
    depositAmount: number;
    depositOriginalAmount: number;
    withdrawalCount: number;
    withdrawalAmount: number;
    feeAmount: number;
  }>();

  for (const t of txs) {
    const date = t.createdAt.toISOString().split("T")[0];
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
    const d = byDate.get(date)!;
    if (t.type === "deposit") {
      d.depositCount++;
      d.depositAmount += Number(t.amount);
      d.depositOriginalAmount += Number(t.originalAmount);
    } else {
      d.withdrawalCount++;
      d.withdrawalAmount += Number(t.amount);
    }
    d.feeAmount += Number(t.fee);
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
