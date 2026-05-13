import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, withdrawalsTable, adminUsersTable } from "@workspace/db";
import { eq, sql, gte, lte, and } from "drizzle-orm";
import { GetDailyStatisticsQueryParams } from "@workspace/api-zod";

const router = Router();

async function getCallerFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    if (isNaN(id)) return null;
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
    return user ?? null;
  } catch {
    return null;
  }
}

router.get("/statistics/overview", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Today: midnight KST → use server-local midnight (UTC is fine since we compare relative to now)
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
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = GetDailyStatisticsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};

  // FIX: endDate must cover the ENTIRE end day (up to 23:59:59.999)
  // new Date("2026-05-13") parses to midnight UTC, excluding same-day transactions
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
      d.depositAmount += Number(t.amount);               // net credited to VA
      d.depositOriginalAmount += Number(t.originalAmount); // gross before fee
    } else {
      d.withdrawalCount++;
      d.withdrawalAmount += Number(t.amount);            // amount paid out
    }
    d.feeAmount += Number(t.fee);
  }

  const result = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      depositCount: d.depositCount,
      depositAmount: d.depositOriginalAmount,  // show gross deposit amount (before fee)
      withdrawalCount: d.withdrawalCount,
      withdrawalAmount: d.withdrawalAmount,
      feeAmount: d.feeAmount,
      // FIX: netAmount = net deposit credited - withdrawals paid out
      // (amount is already net-of-fee, so do NOT subtract feeAmount again)
      netAmount: d.depositAmount - d.withdrawalAmount,
    }));

  res.json(result);
});

export default router;
