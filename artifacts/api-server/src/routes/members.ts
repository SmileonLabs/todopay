import { Router } from "express";
import { db, membersTable, virtualAccountsTable, adminUsersTable } from "@workspace/db";
import { eq, ilike, and, or, inArray, sql } from "drizzle-orm";
import { ListMembersQueryParams, CreateMemberBody, UpdateMemberBody, UpdateMemberStatusBody } from "@workspace/api-zod";
import { hashPassword, requireAdmin } from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { allowRequest } from "../lib/rate-limit.js";
import { getAccessibleStoreIds } from "../lib/query-utils.js";

const router = Router();

function paymentProviderEnabled(): boolean {
  return process.env.PAYMENT_PROVIDER_ENABLED === "true";
}

function paymentProviderUnavailable(res: import("express").Response): void {
  res.status(503).json({
    error: "가상계좌 발급은 KPPay 실연동 및 1원 인증 완료 전까지 사용할 수 없습니다.",
    code: "PAYMENT_PROVIDER_DISABLED",
  });
}

/** Format a single member with its virtual account and store name (for single-item endpoints). */
async function formatMember(m: typeof membersTable.$inferSelect) {
  const [va] = await db.select().from(virtualAccountsTable)
    .where(and(eq(virtualAccountsTable.memberId, m.id), eq(virtualAccountsTable.status, "active")));
  let storeName: string | null = m.storeCode ?? null;
  if (m.storeId) {
    const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, m.storeId));
    if (store) storeName = store.name;
  }
  return {
    id: m.id,
    loginId: m.loginId,
    name: m.name,
    phone: m.phone,
    email: m.email ?? null,
    storeCode: m.storeCode ?? null,
    storeName,
    birthdate: m.birthdate ?? null,
    isVerified: m.isVerified,
    isActive: m.isActive,
    virtualAccountNumber: va?.accountNumber ?? null,
    virtualAccountBank: va?.bankName ?? null,
    virtualAccountStatus: va?.status ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Batch-format multiple members, loading VAs and store names in 2 queries instead of 2×N. */
async function formatMemberBatch(members: (typeof membersTable.$inferSelect)[]) {
  if (members.length === 0) return [];

  const memberIds = members.map(m => m.id);
  const storeIds = [...new Set(members.filter(m => m.storeId).map(m => m.storeId!))];

  const [activeVAs, stores] = await Promise.all([
    db.select().from(virtualAccountsTable)
      .where(and(inArray(virtualAccountsTable.memberId, memberIds), eq(virtualAccountsTable.status, "active"))),
    storeIds.length > 0
      ? db.select({ id: adminUsersTable.id, name: adminUsersTable.name })
          .from(adminUsersTable).where(inArray(adminUsersTable.id, storeIds))
      : Promise.resolve([]),
  ]);

  const vaMap = new Map(activeVAs.filter(va => va.memberId).map(va => [va.memberId!, va]));
  const storeNameMap = new Map(stores.map(s => [s.id, s.name]));

  return members.map(m => {
    const va = vaMap.get(m.id);
    const storeName = m.storeId ? (storeNameMap.get(m.storeId) ?? m.storeCode ?? null) : (m.storeCode ?? null);
    return {
      id: m.id,
      loginId: m.loginId,
      name: m.name,
      phone: m.phone,
      email: m.email ?? null,
      storeCode: m.storeCode ?? null,
      storeName,
      birthdate: m.birthdate ?? null,
      isVerified: m.isVerified,
      isActive: m.isActive,
      virtualAccountNumber: va?.accountNumber ?? null,
      virtualAccountBank: va?.bankName ?? null,
      virtualAccountStatus: va?.status ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

router.get("/members/register-link", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  res.json({ url: `https://${baseUrl}/register/member` });
});

router.get("/members", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ListMembersQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const accessibleStoreIds = await getAccessibleStoreIds(caller);

  const conditions = [];

  if (accessibleStoreIds !== null) {
    if (accessibleStoreIds.length === 0) {
      res.json({ items: [], total: 0 }); return;
    }
    conditions.push(inArray(membersTable.storeId, accessibleStoreIds));
  }

  if (params.storeCode) conditions.push(eq(membersTable.storeCode, params.storeCode));
  if (params.search) {
    conditions.push(or(
      ilike(membersTable.name, `%${params.search}%`),
      ilike(membersTable.loginId, `%${params.search}%`),
      ilike(membersTable.phone, `%${params.search}%`)
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [members, [{ count }]] = await Promise.all([
    db.select().from(membersTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(membersTable).where(where),
  ]);
  const formatted = await formatMemberBatch(members);
  res.json({ items: formatted, total: Number(count) });
});

router.post("/members", async (req, res) => {
  if (!paymentProviderEnabled()) {
    paymentProviderUnavailable(res);
    return;
  }
  if (!(await allowRequest("member-register", req.ip ?? "unknown", { limit: 10, windowSeconds: 60 * 60 }))) {
    res.status(429).json({ error: "Too many registration attempts" }); return;
  }
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { loginId, password, name, phone, email, storeCode, birthdate } = parsed.data;

  const normalizedStoreCode = storeCode?.trim();
  if (!normalizedStoreCode) {
    res.status(400).json({ error: "매장코드는 필수입니다" }); return;
  }

  const [store] = await db.select().from(adminUsersTable)
    .where(and(eq(adminUsersTable.loginId, normalizedStoreCode), eq(adminUsersTable.role, "store")));
  if (!store) { res.status(400).json({ error: "유효하지 않은 매장코드입니다" }); return; }

  const [existing] = await db.select().from(membersTable).where(eq(membersTable.loginId, loginId));
  if (existing) { res.status(409).json({ error: "이미 사용중인 아이디입니다" }); return; }

  const passwordHash = await hashPassword(password);
  let createdMember: typeof membersTable.$inferSelect | null = null;

  await db.transaction(async (dbtx) => {
    const [m] = await dbtx.insert(membersTable).values({
      loginId,
      passwordHash,
      name,
      phone,
      email: email ?? null,
      storeCode: normalizedStoreCode,
      storeId: store.id,
      birthdate: birthdate ?? null,
      isVerified: true,
    }).returning();

    createdMember = m;
  });

  if (!createdMember) {
    res.status(500).json({ error: "회원 등록 중 오류가 발생했습니다" }); return;
  }

  const created = createdMember as typeof membersTable.$inferSelect;
  await writeAuditLog(req, { actorType: "system", action: "member.register", resourceType: "member", resourceId: created.id, metadata: { storeId: store.id } });

  res.status(201).json(await formatMember(created));
});

router.get("/members/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }

  if (caller.role !== "superadmin" && m.storeId) {
    const accessibleStoreIds = await getAccessibleStoreIds(caller);
    if (accessibleStoreIds !== null && !accessibleStoreIds.includes(m.storeId)) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  res.json(await formatMember(m));
});

router.patch("/members/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }

  if (caller.role !== "superadmin" && m.storeId) {
    const accessibleStoreIds = await getAccessibleStoreIds(caller);
    if (accessibleStoreIds !== null && !accessibleStoreIds.includes(m.storeId)) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  const updates: Partial<typeof membersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email ?? undefined;
  if (parsed.data.birthdate !== undefined) updates.birthdate = parsed.data.birthdate ?? undefined;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "변경할 항목이 없습니다" }); return; }
  const [updated] = await db.update(membersTable).set(updates).where(eq(membersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatMember(updated));
});

router.patch("/members/:id/status", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateMemberStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [m_] = await db.update(membersTable)
    .set({ isActive: parsed.data.isActive })
    .where(eq(membersTable.id, id))
    .returning({ id: membersTable.id });
  if (!m_) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

router.post("/members/:id/virtual-account", async (req, res) => {
  if (!paymentProviderEnabled()) {
    paymentProviderUnavailable(res);
    return;
  }
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }

  if (caller.role !== "superadmin" && m.storeId) {
    const accessibleStoreIds = await getAccessibleStoreIds(caller);
    if (accessibleStoreIds !== null && !accessibleStoreIds.includes(m.storeId)) {
      res.status(403).json({ error: "권한이 없습니다" }); return;
    }
  }

  res.status(501).json({ error: "KPPay 가상계좌 재발급 연동이 아직 구현되지 않았습니다." });
});

router.delete("/members/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.transaction(async (dbtx) => {
    await dbtx.update(virtualAccountsTable)
      .set({ status: "revoked" })
      .where(eq(virtualAccountsTable.memberId, id));
    await dbtx.delete(membersTable).where(eq(membersTable.id, id));
  });

  res.status(204).send();
});

export default router;
