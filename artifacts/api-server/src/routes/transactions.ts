import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, adminUsersTable, feeConfigsTable, balanceRecordsTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte } from "drizzle-orm";
import { ListTransactionsQueryParams } from "@workspace/api-zod";

const router = Router();

function getAdminId(authHeader: string | undefined): number | null {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

router.get("/transactions", async (req, res) => {
  const parsed = ListTransactionsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.type) conditions.push(eq(transactionsTable.type, params.type));
  if ((params as { status?: string }).status)
    conditions.push(eq(transactionsTable.status, (params as { status?: string }).status!));
  if ((params as { storeId?: number }).storeId) {
    const storeId = (params as { storeId?: number }).storeId!;
    const storeMembers = await db.select({ id: membersTable.id })
      .from(membersTable).where(eq(membersTable.storeId, storeId));
    const ids = storeMembers.map(m => m.id);
    if (ids.length === 0) {
      res.json({ items: [], total: 0 });
      return;
    }
    conditions.push(sql`${transactionsTable.memberId} = ANY(ARRAY[${sql.raw(ids.join(","))}])`);
  }
  if (params.startDate) conditions.push(gte(transactionsTable.createdAt, new Date(params.startDate)));
  if (params.endDate) conditions.push(lte(transactionsTable.createdAt, new Date(params.endDate)));
  if (params.search) {
    conditions.push(or(
      ilike(transactionsTable.trackingNumber, `%${params.search}%`),
      ilike(transactionsTable.fromAccount, `%${params.search}%`),
      ilike(transactionsTable.toAccount, `%${params.search}%`)
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [txs, [{ count }]] = await Promise.all([
    db.select().from(transactionsTable).where(where).limit(limit).offset(offset).orderBy(sql`${transactionsTable.createdAt} desc`),
    db.select({ count: sql<number>`count(*)` }).from(transactionsTable).where(where),
  ]);

  const formatted = await Promise.all(txs.map(async (t) => {
    let memberName: string | null = null;
    if (t.memberId) {
      const [m] = await db.select().from(membersTable).where(eq(membersTable.id, t.memberId));
      memberName = m?.name ?? null;
    }
    return {
      id: t.id,
      type: t.type,
      originalAmount: Number(t.originalAmount),
      amount: Number(t.amount),
      fee: Number(t.fee),
      status: t.status,
      fromAccount: t.fromAccount,
      toAccount: t.toAccount,
      trackingNumber: t.trackingNumber,
      pgTransactionId: t.pgTransactionId,
      memberName,
      memberId: t.memberId ?? null,
      createdAt: t.createdAt.toISOString(),
    };
  }));

  res.json({ items: formatted, total: Number(count) });
});

// 입금 확인: 원자적 상태 전환 (pending → success)
// SELECT + UPDATE 분리 시 동시 클릭으로 잔액 이중 적립 가능 → WHERE status = 'pending' 조건으로 방지
router.post("/transactions/:id/confirm", async (req, res) => {
  const adminId = getAdminId(req.headers.authorization);
  if (!adminId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [admin] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, adminId));
  if (!admin || !admin.isActive) { res.status(401).json({ error: "Unauthorized" }); return; }

  const txId = parseInt(req.params.id, 10);

  // 거래 조회 (권한 확인 및 수수료 계산용)
  const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
  if (!tx) { res.status(404).json({ error: "거래를 찾을 수 없습니다" }); return; }
  if (tx.type !== "deposit") { res.status(400).json({ error: "입금 거래만 확인 처리할 수 있습니다" }); return; }
  // 이미 처리된 건 빠른 반환 (UX용 — 실제 중복 방지는 아래 원자적 UPDATE에서)
  if (tx.status !== "pending") { res.status(400).json({ error: "이미 처리된 거래입니다" }); return; }

  let member: typeof membersTable.$inferSelect | null = null;
  if (tx.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, tx.memberId));
    member = m ?? null;
  }

  // 매장 권한 확인
  if (admin.role === "store" && member) {
    if (member.storeId !== admin.id) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  // 수수료 계산
  const originalAmount = Number(tx.originalAmount);
  let feeRate = 0;
  if (member?.storeId) {
    const [feeConfig] = await db.select().from(feeConfigsTable)
      .where(eq(feeConfigsTable.userId, member.storeId));
    if (feeConfig) feeRate = Number(feeConfig.depositFee);
  }
  const feeAmount = Math.round(originalAmount * feeRate / 100);
  const netAmount = originalAmount - feeAmount;

  // 원자적 상태 전환: WHERE status = 'pending' 조건 포함
  // 동시에 두 요청이 들어와도 하나만 성공, 나머지는 0 rows 반환
  const [updated] = await db.update(transactionsTable)
    .set({
      status: "success",
      fee: feeAmount.toFixed(2),
      amount: netAmount.toFixed(2),
    })
    .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.status, "pending")))
    .returning();

  if (!updated) {
    res.status(400).json({ error: "이미 처리된 거래입니다" }); return;
  }

  // 가상계좌 잔액 적립 (원자적 덧셈 — 위 UPDATE 성공 후 한 번만 실행됨)
  if (tx.memberId) {
    await db.update(virtualAccountsTable)
      .set({ balance: sql`balance + ${netAmount}` })
      .where(eq(virtualAccountsTable.memberId, tx.memberId));
  }

  // balance_records 기록
  const [lastBal] = await db.select().from(balanceRecordsTable).orderBy(sql`created_at desc`).limit(1);
  const prevBal = Number(lastBal?.balance ?? 0);
  await db.insert(balanceRecordsTable).values({
    direction: "in",
    category: "deposit",
    amount: originalAmount.toFixed(2),
    balance: (prevBal + originalAmount).toFixed(2),
    description: `입금 확인 - ${tx.trackingNumber} (수수료 ${feeAmount.toLocaleString("ko-KR")}원)`,
    userId: member?.storeId ?? null,
  });

  res.json({ success: true, id: updated.id, status: updated.status, fee: feeAmount, amount: netAmount });
});

export default router;
