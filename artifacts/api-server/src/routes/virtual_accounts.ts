import { Router } from "express";
import { db, virtualAccountsTable, membersTable, adminUsersTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { ListVirtualAccountsQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";
import { getAccessibleStoreIds } from "../lib/query-utils.js";

const router = Router();

router.get("/virtual-accounts", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ListVirtualAccountsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];

  // 역할별 접근 가능한 매장 → 회원 → 가상계좌 필터링
  const accessibleStoreIds = await getAccessibleStoreIds(caller);
  if (accessibleStoreIds !== null) {
    if (accessibleStoreIds.length === 0) {
      res.json({ items: [], total: 0 });
      return;
    }
    const storeMembers = await db
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(inArray(membersTable.storeId, accessibleStoreIds));
    const memberIds = storeMembers.map(m => m.id);
    if (memberIds.length === 0) {
      res.json({ items: [], total: 0 });
      return;
    }
    conditions.push(inArray(virtualAccountsTable.memberId, memberIds));
  }

  if (params.memberId) conditions.push(eq(virtualAccountsTable.memberId, params.memberId));
  if (params.status) conditions.push(eq(virtualAccountsTable.status, params.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [accounts, [{ count }]] = await Promise.all([
    db.select().from(virtualAccountsTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(virtualAccountsTable).where(where),
  ]);

  // Batch-load member names to avoid N+1 queries
  const memberIds = [...new Set(accounts.filter(a => a.memberId).map(a => a.memberId!))];
  const memberList = memberIds.length > 0
    ? await db.select({ id: membersTable.id, name: membersTable.name })
        .from(membersTable).where(inArray(membersTable.id, memberIds))
    : [];
  const memberNameMap = new Map(memberList.map(m => [m.id, m.name]));

  const formatted = accounts.map(va => ({
    id: va.id,
    accountNumber: va.accountNumber,
    bankName: va.bankName,
    status: va.status,
    memberId: va.memberId ?? 0,
    memberName: va.memberId ? (memberNameMap.get(va.memberId) ?? "") : "",
    createdAt: va.createdAt.toISOString(),
  }));

  res.json({ items: formatted, total: Number(count) });
});

router.get("/virtual-accounts/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.id, id));
  if (!va) { res.status(404).json({ error: "Not found" }); return; }

  // 접근 권한 확인
  if (va.memberId && caller.role !== "superadmin") {
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, va.memberId));
    if (member?.storeId) {
      const accessibleStoreIds = await getAccessibleStoreIds(caller);
      if (accessibleStoreIds !== null && !accessibleStoreIds.includes(member.storeId)) {
        res.status(403).json({ error: "권한이 없습니다" }); return;
      }
    }
  }

  let memberName = "";
  if (va.memberId) {
    const [m] = await db.select({ name: membersTable.name }).from(membersTable).where(eq(membersTable.id, va.memberId));
    memberName = m?.name ?? "";
  }
  res.json({
    id: va.id,
    accountNumber: va.accountNumber,
    bankName: va.bankName,
    status: va.status,
    memberId: va.memberId ?? 0,
    memberName,
    createdAt: va.createdAt.toISOString(),
  });
});

export default router;
