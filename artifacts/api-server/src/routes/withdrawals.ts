import { Router } from "express";
import { db, withdrawalsTable, membersTable, adminUsersTable, feeConfigsTable, virtualAccountsTable, balanceRecordsTable } from "@workspace/db";
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

// 관리자 직접 출금 생성 (회원 잔액 차감 포함)
router.post("/withdrawals", async (req, res) => {
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { amount, accountNumber, accountBank, accountHolder } = parsed.data;

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

    // 회원 잔액 원자적 차감: raw SQL로 balance >= amount 조건 + 차감을 단일 DB 연산으로 처리
    const deductResult = await db.execute(
      sql`UPDATE virtual_accounts
          SET balance = balance - ${Number(amount)}
          WHERE member_id = ${memberId} AND balance >= ${Number(amount)}
          RETURNING id`
    );
    if (!deductResult.rows || deductResult.rows.length === 0) {
      const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, memberId));
      res.status(400).json({ error: `잔액이 부족합니다 (현재 잔액: ${Number(va?.balance ?? 0).toLocaleString("ko-KR")}원)` }); return;
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

// 출금 승인: 원자적 상태 전환 (pending → approved)
// 잔액은 신청 시점에 이미 예약 차감됨 — 승인 시 상태만 변경
router.post("/withdrawals/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  // SELECT + UPDATE 분리 시 동시 요청이 둘 다 pending 체크를 통과할 수 있음
  // WHERE approvalStatus = 'pending' 조건을 UPDATE에 포함해 원자적으로 처리
  const [updated] = await db.update(withdrawalsTable)
    .set({ approvalStatus: "approved" })
    .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.approvalStatus, "pending")))
    .returning();

  if (!updated) {
    // 행이 없거나 이미 처리된 경우
    const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
  }

  // balance_records 기록
  const [lastBal] = await db.select().from(balanceRecordsTable).orderBy(sql`created_at desc`).limit(1);
  const prevBal = Number(lastBal?.balance ?? 0);
  await db.insert(balanceRecordsTable).values({
    direction: "out",
    category: "withdrawal",
    amount: updated.amount,
    balance: (prevBal - Number(updated.amount)).toFixed(2),
    description: `출금 승인 - ${updated.trackingNumber} (실지급 ${Number(updated.totalAmount).toLocaleString("ko-KR")}원)`,
    userId: updated.storeId ?? null,
  });

  res.json(await formatWithdrawal(updated));
});

// 출금 거절: 원자적 상태 전환 (pending → rejected) + 잔액 복원
router.post("/withdrawals/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = RejectWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  // 원자적으로 pending → rejected 전환
  // 이미 처리된 건은 WHERE 조건에서 걸려 0 rows 반환
  const [rejected] = await db.update(withdrawalsTable)
    .set({ approvalStatus: "rejected", rejectReason: parsed.data.reason })
    .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.approvalStatus, "pending")))
    .returning();

  if (!rejected) {
    const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
  }

  // 거절 확정 후 예약 차감분 복원 (원자적 덧셈 — 이중 복원 없음: 위 UPDATE가 한 번만 성공)
  if (rejected.memberId) {
    await db.update(virtualAccountsTable)
      .set({ balance: sql`balance + ${Number(rejected.amount)}` })
      .where(eq(virtualAccountsTable.memberId, rejected.memberId));
  }

  res.json(await formatWithdrawal(rejected));
});

export default router;
