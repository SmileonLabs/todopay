import { Router } from "express";
import { db, withdrawalsTable, membersTable, adminUsersTable, feeConfigsTable, virtualAccountsTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte } from "drizzle-orm";
import { ListWithdrawalsQueryParams, CreateWithdrawalBody, RejectWithdrawalBody } from "@workspace/api-zod";
import crypto from "crypto";

const router = Router();

async function formatWithdrawal(w: typeof withdrawalsTable.$inferSelect) {
  let memberName: string | null = null;
  let storeName: string | null = null;
  if (w.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, w.memberId));
    memberName = m?.name ?? null;
    if (m?.storeId) {
      const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, m.storeId));
      storeName = store?.name ?? null;
    }
  }
  return {
    id: w.id,
    trackingNumber: w.trackingNumber,
    amount: Number(w.amount),
    fee: Number(w.fee),
    totalAmount: Number(w.totalAmount),
    approvalStatus: w.approvalStatus,
    withdrawalStatus: w.withdrawalStatus,
    accountNumber: w.accountNumber,
    accountBank: w.accountBank,
    accountHolder: w.accountHolder,
    rejectReason: w.rejectReason ?? null,
    memberName,
    storeName,
    createdAt: w.createdAt.toISOString(),
  };
}

router.get("/withdrawals/summary", async (_req, res) => {
  const [pending] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<number>`coalesce(sum(total_amount), 0)`,
  }).from(withdrawalsTable).where(eq(withdrawalsTable.approvalStatus, "pending"));
  const [approved] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<number>`coalesce(sum(total_amount), 0)`,
  }).from(withdrawalsTable).where(eq(withdrawalsTable.approvalStatus, "approved"));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayRow] = await db.select({
    amount: sql<number>`coalesce(sum(amount), 0)`,
  }).from(withdrawalsTable).where(and(
    eq(withdrawalsTable.withdrawalStatus, "paid"),
    gte(withdrawalsTable.createdAt, today)
  ));
  res.json({
    pendingCount: Number(pending.count),
    pendingAmount: Number(pending.amount),
    approvedCount: Number(approved.count),
    approvedAmount: Number(approved.amount),
    todayWithdrawn: Number(todayRow.amount),
  });
});

router.get("/withdrawals", async (req, res) => {
  const parsed = ListWithdrawalsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.approvalStatus) conditions.push(eq(withdrawalsTable.approvalStatus, params.approvalStatus));
  if (params.withdrawalStatus) conditions.push(eq(withdrawalsTable.withdrawalStatus, params.withdrawalStatus));
  if (params.startDate) conditions.push(gte(withdrawalsTable.createdAt, new Date(params.startDate)));
  if (params.endDate) conditions.push(lte(withdrawalsTable.createdAt, new Date(params.endDate)));
  if (params.search) {
    conditions.push(or(
      ilike(withdrawalsTable.trackingNumber, `%${params.search}%`),
      ilike(withdrawalsTable.accountNumber, `%${params.search}%`),
      ilike(withdrawalsTable.accountHolder, `%${params.search}%`)
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [withdrawals, [{ count }], [totals]] = await Promise.all([
    db.select().from(withdrawalsTable).where(where).limit(limit).offset(offset).orderBy(sql`created_at desc`),
    db.select({ count: sql<number>`count(*)` }).from(withdrawalsTable).where(where),
    db.select({
      totalAmount: sql<number>`coalesce(sum(amount), 0)`,
      totalFee: sql<number>`coalesce(sum(fee), 0)`,
    }).from(withdrawalsTable).where(where),
  ]);

  const formatted = await Promise.all(withdrawals.map(formatWithdrawal));
  res.json({
    items: formatted,
    total: Number(count),
    totalAmount: Number(totals.totalAmount),
    totalFee: Number(totals.totalFee),
  });
});

router.post("/withdrawals", async (req, res) => {
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { amount, accountNumber, accountBank, accountHolder } = parsed.data;

  // memberId optional (not in OpenAPI spec, passed manually by admin)
  const memberId: number | null = typeof req.body.memberId === "number" ? req.body.memberId : null;

  let feeRate = 0;
  let storeId: number | null = null;
  if (memberId) {
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
    if (member?.storeId) {
      storeId = member.storeId;
      const [feeConfig] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, member.storeId));
      if (feeConfig) feeRate = Number(feeConfig.withdrawalFee);
    }
  }

  const fee = Math.round(Number(amount) * feeRate / 100);
  const totalAmount = Number(amount) - fee;

  const [w] = await db.insert(withdrawalsTable).values({
    trackingNumber: crypto.randomUUID().replace(/-/g, "").substring(0, 16).toUpperCase(),
    amount: String(amount),
    fee: String(fee),
    totalAmount: String(totalAmount),
    approvalStatus: "pending",
    withdrawalStatus: "unpaid",
    accountNumber,
    accountBank,
    accountHolder,
    memberId,
    storeId,
  }).returning();
  res.status(201).json(await formatWithdrawal(w));
});

router.post("/withdrawals/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const [w] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!w) { res.status(404).json({ error: "Not found" }); return; }
  if (w.approvalStatus !== "pending") { res.status(400).json({ error: "이미 처리된 출금입니다" }); return; }

  // 가상계좌 잔액 차감
  if (w.memberId) {
    const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, w.memberId));
    if (va) {
      const newBalance = Number(va.balance) - Number(w.amount);
      if (newBalance < 0) {
        res.status(400).json({ error: "잔액이 부족합니다" }); return;
      }
      await db.update(virtualAccountsTable)
        .set({ balance: newBalance.toFixed(2) })
        .where(eq(virtualAccountsTable.id, va.id));
    }
  }

  const [updated] = await db.update(withdrawalsTable)
    .set({ approvalStatus: "approved" })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  res.json(await formatWithdrawal(updated));
});

router.post("/withdrawals/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = RejectWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [w] = await db.update(withdrawalsTable)
    .set({ approvalStatus: "rejected", rejectReason: parsed.data.reason })
    .where(eq(withdrawalsTable.id, id))
    .returning();
  if (!w) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatWithdrawal(w));
});

export default router;
