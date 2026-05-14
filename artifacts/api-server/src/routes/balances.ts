import { Router } from "express";
import { db, balanceRecordsTable, withdrawalsTable } from "@workspace/db";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { ListBalanceRecordsQueryParams } from "@workspace/api-zod";

const router = Router();

async function getRunningBalance(): Promise<number> {
  const [result] = await db.select({
    balance: sql<string>`COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)`,
  }).from(balanceRecordsTable);
  return Number(result?.balance ?? 0);
}

router.get("/balances/summary", async (_req, res) => {
  const balance = await getRunningBalance();

  // 지급보류: 승인됐지만 아직 미지급 출금 합계
  const [pending] = await db.select({
    amount: sql<number>`coalesce(sum(amount), 0)`,
  }).from(withdrawalsTable).where(and(
    eq(withdrawalsTable.approvalStatus, "approved"),
    eq(withdrawalsTable.withdrawalStatus, "unpaid")
  ));

  res.json({
    balance,
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

router.post("/balances", async (req, res) => {
  const { direction, category, amount, description } = req.body as {
    direction?: string; category?: string; amount?: number; description?: string;
  };
  if (!direction || !["in", "out"].includes(direction)) {
    res.status(400).json({ error: "direction은 'in' 또는 'out'이어야 합니다" }); return;
  }
  if (!category) { res.status(400).json({ error: "category를 입력해주세요" }); return; }
  if (!amount || Number(amount) <= 0) { res.status(400).json({ error: "금액을 올바르게 입력해주세요" }); return; }

  const prevBalance = await getRunningBalance();
  const newBalance = direction === "in"
    ? prevBalance + Number(amount)
    : prevBalance - Number(amount);

  const [record] = await db.insert(balanceRecordsTable).values({
    direction,
    category,
    amount: Number(amount).toFixed(2),
    balance: newBalance.toFixed(2),
    description: description?.trim() || null,
  }).returning();

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
