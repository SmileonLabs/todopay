import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, adminUsersTable, feeConfigsTable, balanceRecordsTable, storeBalancesTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte } from "drizzle-orm";
import { ListTransactionsQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

router.get("/transactions", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

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
    conditions.push(sql`${transactionsTable.memberId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
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

router.post("/transactions/:id/confirm", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const txId = parseInt(req.params.id, 10);

  const [txCheck] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
  if (!txCheck) { res.status(404).json({ error: "거래를 찾을 수 없습니다" }); return; }
  if (txCheck.type !== "deposit") { res.status(400).json({ error: "입금 거래만 확인 처리할 수 있습니다" }); return; }
  if (txCheck.status !== "pending") { res.status(400).json({ error: "이미 처리된 거래입니다" }); return; }

  let member: typeof membersTable.$inferSelect | null = null;
  if (txCheck.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, txCheck.memberId));
    member = m ?? null;
  }

  if (caller.role === "store" && member) {
    if (member.storeId !== caller.id) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  const originalAmount = Number(txCheck.originalAmount);
  const storeId = member?.storeId ?? null;

  let depositFixedFee = 0;
  let usageFeeRate = 0;

  if (storeId) {
    const [feeConfig] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, storeId));
    if (feeConfig) {
      depositFixedFee = Number(feeConfig.depositFee);
      usageFeeRate = Number(feeConfig.usageFeeRate);
    }
  }

  const usageFeeAmount = Math.round(originalAmount * usageFeeRate / 100);
  const totalFeeAmount = depositFixedFee + usageFeeAmount;
  const netToStore = originalAmount - totalFeeAmount;

  const feeDistributions: Array<{ userId: number; amount: number; description: string }> = [];
  if (usageFeeAmount > 0 && storeId) {
    let prevChildRate = usageFeeRate;
    let currentUserId = storeId;

    while (true) {
      const [currentUser] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, currentUserId));
      if (!currentUser || !currentUser.parentId) {
        if (prevChildRate > 0) {
          const topAmount = Math.round(originalAmount * prevChildRate / 100);
          if (topAmount > 0) {
            feeDistributions.push({
              userId: currentUserId,
              amount: topAmount,
              description: `이용수수료 수당 [${currentUserId}] - ${txCheck.trackingNumber} (${prevChildRate}%)`,
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
          feeDistributions.push({
            userId: currentUser.parentId,
            amount: levelAmount,
            description: `이용수수료 수당 [${currentUser.parentId}] - ${txCheck.trackingNumber} (마진 ${levelMarginRate}%)`,
          });
        }
      }

      prevChildRate = parentRate;
      currentUserId = currentUser.parentId;
      if (prevChildRate <= 0) break;
    }
  }

  let result: { id: number; status: string } | null = null;

  await db.transaction(async (dbtx) => {
    const [updated] = await dbtx.update(transactionsTable)
      .set({
        status: "success",
        fee: totalFeeAmount.toFixed(2),
        amount: netToStore.toFixed(2),
      })
      .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.status, "pending")))
      .returning();

    if (!updated) {
      throw new Error("ALREADY_PROCESSED");
    }

    if (storeId && netToStore > 0) {
      await dbtx.execute(sql`
        INSERT INTO store_balances (store_id, balance, updated_at)
        VALUES (${storeId}, ${netToStore.toFixed(2)}, NOW())
        ON CONFLICT (store_id) DO UPDATE
          SET balance    = store_balances.balance + ${netToStore.toFixed(2)},
              updated_at = NOW()
      `);
    }

    for (const dist of feeDistributions) {
      await dbtx.insert(balanceRecordsTable).values({
        direction: "in",
        category: "payment",
        amount: dist.amount.toFixed(2),
        balance: "0",
        description: dist.description,
        userId: dist.userId,
      });
    }

    if (storeId) {
      await dbtx.insert(balanceRecordsTable).values({
        direction: "in",
        category: "deposit",
        amount: originalAmount.toFixed(2),
        balance: "0",
        description: `구매 확인 - ${txCheck.trackingNumber} (입금수수료 ${depositFixedFee.toLocaleString("ko-KR")}원, 이용수수료 ${usageFeeAmount.toLocaleString("ko-KR")}원)`,
        userId: storeId,
      });
    }

    result = { id: updated.id, status: updated.status };
  });

  if (!result) {
    res.status(400).json({ error: "이미 처리된 거래입니다" }); return;
  }

  res.json({
    success: true,
    id: (result as { id: number }).id,
    status: (result as { status: string }).status,
    fee: totalFeeAmount,
    depositFixedFee,
    usageFeeAmount,
    amount: netToStore,
  });
});

export default router;
