import { Router } from "express";
import { db, balanceRecordsTable, transactionsTable, membersTable } from "@workspace/db";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

router.get("/settlements/summary", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

  if (caller.role === "store") {
    const members = await db.select({ id: membersTable.id }).from(membersTable)
      .where(eq(membersTable.storeId, caller.id));
    const memberIds = members.map(m => m.id);

    if (memberIds.length === 0) {
      res.json({ type: "expense", totalDeposit: 0, totalFee: 0, totalNet: 0, txCount: 0 });
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [
      sql`${transactionsTable.status} = 'success'`,
      sql`${transactionsTable.type} = 'deposit'`,
      inArray(transactionsTable.memberId, memberIds),
    ];
    if (startDate) conditions.push(gte(transactionsTable.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(transactionsTable.createdAt, new Date(endDate)));

    const [result] = await db.select({
      totalDeposit: sql<string>`coalesce(sum(original_amount), 0)`,
      totalFee: sql<string>`coalesce(sum(fee), 0)`,
      totalNet: sql<string>`coalesce(sum(amount), 0)`,
      txCount: sql<string>`count(*)`,
    }).from(transactionsTable).where(and(...conditions));

    res.json({
      type: "expense",
      totalDeposit: Number(result.totalDeposit),
      totalFee: Number(result.totalFee),
      totalNet: Number(result.totalNet),
      txCount: Number(result.txCount),
    });
  } else {
    const userId = caller.role === "superadmin" ? undefined : caller.id;

    const conditions: ReturnType<typeof eq>[] = [
      eq(balanceRecordsTable.direction, "in"),
      eq(balanceRecordsTable.category, "payment"),
    ];
    if (userId != null) conditions.push(eq(balanceRecordsTable.userId, userId));
    if (startDate) conditions.push(gte(balanceRecordsTable.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(balanceRecordsTable.createdAt, new Date(endDate)));

    const [result] = await db.select({
      totalIncome: sql<string>`coalesce(sum(amount), 0)`,
      recordCount: sql<string>`count(*)`,
    }).from(balanceRecordsTable).where(and(...conditions));

    res.json({
      type: "income",
      totalIncome: Number(result.totalIncome),
      recordCount: Number(result.recordCount),
    });
  }
});

router.get("/settlements/records", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { startDate, endDate, page: pageStr, limit: limitStr } = req.query as {
    startDate?: string; endDate?: string; page?: string; limit?: string;
  };
  const page = Number(pageStr ?? 1);
  const limit = Number(limitStr ?? 20);
  const offset = (page - 1) * limit;

  if (caller.role === "store") {
    const members = await db.select({ id: membersTable.id }).from(membersTable)
      .where(eq(membersTable.storeId, caller.id));
    const memberIds = members.map(m => m.id);

    if (memberIds.length === 0) {
      res.json({ type: "expense", items: [], total: 0 });
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [
      sql`${transactionsTable.status} = 'success'`,
      sql`${transactionsTable.type} = 'deposit'`,
      inArray(transactionsTable.memberId, memberIds),
    ];
    if (startDate) conditions.push(gte(transactionsTable.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(transactionsTable.createdAt, new Date(endDate)));
    const where = and(...conditions);

    const [txs, [{ count }]] = await Promise.all([
      db.select().from(transactionsTable).where(where).limit(limit).offset(offset)
        .orderBy(sql`${transactionsTable.createdAt} desc`),
      db.select({ count: sql<string>`count(*)` }).from(transactionsTable).where(where),
    ]);

    res.json({
      type: "expense",
      items: txs.map(t => ({
        id: t.id,
        originalAmount: Number(t.originalAmount),
        fee: Number(t.fee),
        amount: Number(t.amount),
        trackingNumber: t.trackingNumber ?? null,
        description: null,
        createdAt: t.createdAt.toISOString(),
      })),
      total: Number(count),
    });
  } else {
    const userId = caller.role === "superadmin" ? undefined : caller.id;

    const conditions: ReturnType<typeof eq>[] = [
      eq(balanceRecordsTable.direction, "in"),
      eq(balanceRecordsTable.category, "payment"),
    ];
    if (userId != null) conditions.push(eq(balanceRecordsTable.userId, userId));
    if (startDate) conditions.push(gte(balanceRecordsTable.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(balanceRecordsTable.createdAt, new Date(endDate)));
    const where = and(...conditions);

    const [records, [{ count }]] = await Promise.all([
      db.select().from(balanceRecordsTable).where(where).limit(limit).offset(offset)
        .orderBy(sql`${balanceRecordsTable.createdAt} desc`),
      db.select({ count: sql<string>`count(*)` }).from(balanceRecordsTable).where(where),
    ]);

    res.json({
      type: "income",
      items: records.map(r => ({
        id: r.id,
        amount: Number(r.amount),
        description: r.description ?? null,
        originalAmount: null,
        fee: null,
        trackingNumber: null,
        createdAt: r.createdAt.toISOString(),
      })),
      total: Number(count),
    });
  }
});

export default router;
