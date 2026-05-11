import { Router } from "express";
import { db, transactionsTable, membersTable, virtualAccountsTable, adminUsersTable } from "@workspace/db";
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

router.post("/transactions/:id/confirm", async (req, res) => {
  const adminId = getAdminId(req.headers.authorization);
  if (!adminId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [admin] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, adminId));
  if (!admin || !admin.isActive) { res.status(401).json({ error: "Unauthorized" }); return; }

  const txId = parseInt(req.params.id, 10);
  const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
  if (!tx) { res.status(404).json({ error: "거래를 찾을 수 없습니다" }); return; }
  if (tx.status !== "pending") { res.status(400).json({ error: "이미 처리된 거래입니다" }); return; }
  if (tx.type !== "deposit") { res.status(400).json({ error: "입금 거래만 확인 처리할 수 있습니다" }); return; }

  if (admin.role === "store" && tx.memberId) {
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, tx.memberId));
    if (!member || member.storeId !== admin.id) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  const [updated] = await db.update(transactionsTable)
    .set({ status: "success" })
    .where(eq(transactionsTable.id, txId))
    .returning();

  if (tx.memberId) {
    const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, tx.memberId));
    if (va) {
      const newBalance = (Number(va.balance) + Number(tx.amount)).toFixed(2);
      await db.update(virtualAccountsTable)
        .set({ balance: newBalance })
        .where(eq(virtualAccountsTable.id, va.id));
    }
  }

  res.json({ success: true, id: updated.id, status: updated.status });
});

export default router;
