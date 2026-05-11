import { Router } from "express";
import { db, balanceRecordsTable } from "@workspace/db";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { ListBalanceRecordsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/balances/summary", async (_req, res) => {
  const [last] = await db.select().from(balanceRecordsTable).orderBy(sql`created_at desc`).limit(1);
  const [pending] = await db.select({
    amount: sql<number>`coalesce(sum(amount), 0)`,
  }).from(balanceRecordsTable).where(and(
    eq(balanceRecordsTable.direction, "out"),
    eq(balanceRecordsTable.category, "withdrawal")
  ));
  res.json({
    balance: Number(last?.balance ?? 0),
    pendingAmount: Number(pending.amount),
  });
});

router.get("/balances", async (req, res) => {
  const parsed = ListBalanceRecordsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.type) conditions.push(eq(balanceRecordsTable.direction, params.type));
  if (params.startDate) conditions.push(gte(balanceRecordsTable.createdAt, new Date(params.startDate)));
  if (params.endDate) conditions.push(lte(balanceRecordsTable.createdAt, new Date(params.endDate)));
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

export default router;
