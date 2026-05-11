import { Router } from "express";
import { db, virtualAccountsTable, membersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { ListVirtualAccountsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/virtual-accounts", async (req, res) => {
  const parsed = ListVirtualAccountsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.memberId) conditions.push(eq(virtualAccountsTable.memberId, params.memberId));
  if (params.status) conditions.push(eq(virtualAccountsTable.status, params.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [accounts, [{ count }]] = await Promise.all([
    db.select().from(virtualAccountsTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(virtualAccountsTable).where(where),
  ]);

  const formatted = await Promise.all(accounts.map(async (va) => {
    let memberName = "";
    if (va.memberId) {
      const [m] = await db.select().from(membersTable).where(eq(membersTable.id, va.memberId));
      memberName = m?.name ?? "";
    }
    return {
      id: va.id,
      accountNumber: va.accountNumber,
      bankName: va.bankName,
      status: va.status,
      memberId: va.memberId ?? 0,
      memberName,
      balance: Number(va.balance),
      createdAt: va.createdAt.toISOString(),
    };
  }));

  res.json({ items: formatted, total: Number(count) });
});

router.get("/virtual-accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.id, id));
  if (!va) { res.status(404).json({ error: "Not found" }); return; }
  let memberName = "";
  if (va.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, va.memberId));
    memberName = m?.name ?? "";
  }
  res.json({
    id: va.id,
    accountNumber: va.accountNumber,
    bankName: va.bankName,
    status: va.status,
    memberId: va.memberId ?? 0,
    memberName,
    balance: Number(va.balance),
    createdAt: va.createdAt.toISOString(),
  });
});

export default router;
