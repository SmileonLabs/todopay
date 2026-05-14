import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, adminUsersTable, feeConfigsTable, balanceRecordsTable, storeBalancesTable } from "@workspace/db";
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

// 입금 확인: 매장 잔액 적립 + 3종 수수료 계산 + 이용수수료 계층 배분
// 원자적 상태 전환 (pending → success), WHERE status='pending' 으로 중복 처리 방지
router.post("/transactions/:id/confirm", async (req, res) => {
  const adminId = getAdminId(req.headers.authorization);
  if (!adminId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [admin] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, adminId));
  if (!admin || !admin.isActive) { res.status(401).json({ error: "Unauthorized" }); return; }

  const txId = parseInt(req.params.id, 10);

  const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
  if (!tx) { res.status(404).json({ error: "거래를 찾을 수 없습니다" }); return; }
  if (tx.type !== "deposit") { res.status(400).json({ error: "입금 거래만 확인 처리할 수 있습니다" }); return; }
  if (tx.status !== "pending") { res.status(400).json({ error: "이미 처리된 거래입니다" }); return; }

  let member: typeof membersTable.$inferSelect | null = null;
  if (tx.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, tx.memberId));
    member = m ?? null;
  }

  if (admin.role === "store" && member) {
    if (member.storeId !== admin.id) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  const originalAmount = Number(tx.originalAmount);
  const storeId = member?.storeId ?? null;

  // 수수료 조회
  let depositFixedFee = 0;      // 입금 건당 수수료 (정액, 원)
  let usageFeeRate = 0;         // 이용 수수료율 (%)
  let withdrawalFixedFee = 0;   // 출금 건당 수수료 (나중에 출금 시 사용, 여기선 참고만)

  if (storeId) {
    const [feeConfig] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, storeId));
    if (feeConfig) {
      depositFixedFee = Number(feeConfig.depositFee);
      usageFeeRate = Number(feeConfig.usageFeeRate);
      withdrawalFixedFee = Number(feeConfig.withdrawalFee);
    }
  }

  const usageFeeAmount = Math.round(originalAmount * usageFeeRate / 100);
  const totalFeeAmount = depositFixedFee + usageFeeAmount;
  const netToStore = originalAmount - totalFeeAmount;

  // 원자적 상태 전환: WHERE status='pending' — 동시 요청 중복 방지
  const [updated] = await db.update(transactionsTable)
    .set({
      status: "success",
      fee: totalFeeAmount.toFixed(2),
      amount: netToStore.toFixed(2),
    })
    .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.status, "pending")))
    .returning();

  if (!updated) {
    res.status(400).json({ error: "이미 처리된 거래입니다" }); return;
  }

  // 매장 잔액 적립 (원자적 UPSERT)
  if (storeId && netToStore > 0) {
    await db.execute(sql`
      INSERT INTO store_balances (store_id, balance, updated_at)
      VALUES (${storeId}, ${netToStore.toFixed(2)}, NOW())
      ON CONFLICT (store_id) DO UPDATE
        SET balance    = store_balances.balance + ${netToStore.toFixed(2)},
            updated_at = NOW()
    `);
  }

  // 이용 수수료 계층 배분: 매장(최대) → 대리점 → 총판 → 본사
  // 각 레벨 수익 = (하위 레벨 rate - 현 레벨 rate) × 입금액
  // 예: 매장 5%, 대리점 2%, 총판 1% → 대리점 3%, 총판 1%, 본사 1%
  if (usageFeeAmount > 0 && storeId) {
    let prevChildRate = usageFeeRate;
    let currentUserId = storeId;

    while (true) {
      const [currentUser] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, currentUserId));
      if (!currentUser || !currentUser.parentId) {
        // 최상위 레벨: 남은 rate 전체가 이 레벨 수익
        if (prevChildRate > 0) {
          const topAmount = Math.round(originalAmount * prevChildRate / 100);
          if (topAmount > 0) {
            await db.insert(balanceRecordsTable).values({
              direction: "in",
              category: "payment",
              amount: topAmount.toFixed(2),
              balance: "0",
              description: `이용수수료 수당 [${currentUserId}] - ${tx.trackingNumber} (${prevChildRate}%)`,
              userId: currentUserId,
            });
          }
        }
        break;
      }

      const [parentFeeConfig] = await db.select().from(feeConfigsTable)
        .where(eq(feeConfigsTable.userId, currentUser.parentId));

      const parentRate = parentFeeConfig ? Number(parentFeeConfig.usageFeeRate) : 0;
      const levelMarginRate = prevChildRate - parentRate;

      if (levelMarginRate > 0) {
        const levelAmount = Math.round(originalAmount * levelMarginRate / 100);
        if (levelAmount > 0) {
          await db.insert(balanceRecordsTable).values({
            direction: "in",
            category: "payment",
            amount: levelAmount.toFixed(2),
            balance: "0",
            description: `이용수수료 수당 [${currentUserId}] - ${tx.trackingNumber} (마진 ${levelMarginRate}%)`,
            userId: currentUserId,
          });
        }
      }

      prevChildRate = parentRate;
      currentUserId = currentUser.parentId;

      if (prevChildRate <= 0) break;
    }
  }

  // 플랫폼 balance_records (입금 확인 기록)
  await db.insert(balanceRecordsTable).values({
    direction: "in",
    category: "deposit",
    amount: originalAmount.toFixed(2),
    balance: "0",
    description: `구매 확인 - ${tx.trackingNumber} (입금수수료 ${depositFixedFee.toLocaleString("ko-KR")}원, 이용수수료 ${usageFeeAmount.toLocaleString("ko-KR")}원)`,
    userId: storeId,
  });

  res.json({
    success: true,
    id: updated.id,
    status: updated.status,
    fee: totalFeeAmount,
    depositFixedFee,
    usageFeeAmount,
    amount: netToStore,
  });
});

export default router;
