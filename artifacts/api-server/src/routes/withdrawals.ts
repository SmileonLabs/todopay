import { Router } from "express";
import { db, withdrawalsTable, membersTable, adminUsersTable, feeConfigsTable, balanceRecordsTable, storeBalancesTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte } from "drizzle-orm";
import { ListWithdrawalsQueryParams, CreateWithdrawalBody, RejectWithdrawalBody } from "@workspace/api-zod";
import crypto from "crypto";

const router = Router();

// KST 기준 익일 오전 10시 계산 (UTC로 반환)
function getTomorrow10amKST(): Date {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const nowKST = new Date(Date.now() + KST_OFFSET);
  const tomorrowKST = new Date(nowKST);
  tomorrowKST.setDate(tomorrowKST.getDate() + 1);
  tomorrowKST.setHours(10, 0, 0, 0);
  return new Date(tomorrowKST.getTime() - KST_OFFSET);
}

async function formatWithdrawal(w: typeof withdrawalsTable.$inferSelect) {
  let memberName: string | null = null;
  let storeName: string | null = null;
  if (w.storeId) {
    const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, w.storeId));
    storeName = store?.name ?? null;
  } else if (w.memberId) {
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
    storeId: w.storeId ?? null,
    availableAt: w.availableAt ? w.availableAt.toISOString() : null,
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

// 매장 출금 신청: 매장 잔액 차감 (정액 출금 수수료 적용) + availableAt 설정
router.post("/withdrawals", async (req, res) => {
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { amount, accountNumber, accountBank, accountHolder } = parsed.data;

  const storeId: number | null = typeof req.body.storeId === "number" ? req.body.storeId : null;
  if (!storeId) { res.status(400).json({ error: "storeId가 필요합니다" }); return; }

  const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, storeId));
  if (!store || store.role !== "store") {
    res.status(400).json({ error: "유효하지 않은 매장입니다" }); return;
  }

  // 출금 건당 수수료 조회 (정액, 원)
  let withdrawalFixedFee = 0;
  const [feeConfig] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, storeId));
  if (feeConfig) withdrawalFixedFee = Number(feeConfig.withdrawalFee);

  const fee = withdrawalFixedFee;
  const totalAmount = Number(amount) - fee;
  if (totalAmount <= 0) {
    res.status(400).json({ error: "출금 수수료보다 출금액이 커야 합니다" }); return;
  }

  // 매장 잔액 원자적 차감: balance >= amount 조건
  const deductResult = await db.execute(
    sql`UPDATE store_balances
        SET balance    = balance - ${Number(amount)},
            updated_at = NOW()
        WHERE store_id = ${storeId} AND balance >= ${Number(amount)}
        RETURNING id`
  );
  if (!deductResult.rows || deductResult.rows.length === 0) {
    const [sb] = await db.select().from(storeBalancesTable).where(eq(storeBalancesTable.storeId, storeId));
    const currentBal = sb ? Number(sb.balance) : 0;
    res.status(400).json({ error: `잔액이 부족합니다 (현재 잔액: ${currentBal.toLocaleString("ko-KR")}원)` }); return;
  }

  const availableAt = getTomorrow10amKST();

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
    storeId,
    availableAt,
  }).returning();

  res.status(201).json(await formatWithdrawal(w));
});

// 출금 승인: 익일 10시 KST 이후만 가능, 원자적 pending → approved
router.post("/withdrawals/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  // availableAt 체크를 위해 먼저 조회
  const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (existing.availableAt && new Date() < existing.availableAt) {
    const kstTime = new Date(existing.availableAt.getTime() + 9 * 60 * 60 * 1000);
    const formatted = kstTime.toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
    });
    res.status(400).json({ error: `아직 출금 가능 시간이 아닙니다. ${formatted} 이후에 승인 가능합니다` }); return;
  }

  // 원자적 상태 전환
  const [updated] = await db.update(withdrawalsTable)
    .set({ approvalStatus: "approved" })
    .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.approvalStatus, "pending")))
    .returning();

  if (!updated) {
    res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
  }

  await db.insert(balanceRecordsTable).values({
    direction: "out",
    category: "withdrawal",
    amount: updated.amount,
    balance: "0",
    description: `출금 승인 - ${updated.trackingNumber} (실지급 ${Number(updated.totalAmount).toLocaleString("ko-KR")}원)`,
    userId: updated.storeId ?? null,
  });

  res.json(await formatWithdrawal(updated));
});

// 출금 반려: 원자적 pending → rejected + 매장 잔액 복원
router.post("/withdrawals/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = RejectWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [rejected] = await db.update(withdrawalsTable)
    .set({ approvalStatus: "rejected", rejectReason: parsed.data.reason })
    .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.approvalStatus, "pending")))
    .returning();

  if (!rejected) {
    const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
  }

  // 매장 잔액 복원
  if (rejected.storeId) {
    await db.execute(sql`
      UPDATE store_balances
      SET balance    = balance + ${Number(rejected.amount)},
          updated_at = NOW()
      WHERE store_id = ${rejected.storeId}
    `);
  }

  res.json(await formatWithdrawal(rejected));
});

// GET /store/:storeId/balance — 매장 잔액 조회
router.get("/store/:storeId/balance", async (req, res) => {
  const storeId = parseInt(req.params.storeId, 10);
  const [sb] = await db.select().from(storeBalancesTable).where(eq(storeBalancesTable.storeId, storeId));
  res.json({ balance: sb ? Number(sb.balance) : 0 });
});

export default router;
