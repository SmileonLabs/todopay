import { Router } from "express";
import { db, membersTable, virtualAccountsTable, adminUsersTable } from "@workspace/db";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import { ListMembersQueryParams, CreateMemberBody, UpdateMemberBody, UpdateMemberStatusBody } from "@workspace/api-zod";

const router = Router();

const BANKS = ["국민은행", "신한은행", "우리은행", "하나은행", "기업은행", "농협은행", "카카오뱅크"];

function simpleHash(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function generateAccountNumber(): string {
  return Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");
}

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

router.get("/members/register-link", (_req, res) => {
  const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  res.json({ url: `https://${baseUrl}/register/member` });
});

router.get("/members", async (req, res) => {
  const parsed = ListMembersQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
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
  const formatted = await Promise.all(members.map(formatMember));
  res.json({ items: formatted, total: Number(count) });
});

router.post("/members", async (req, res) => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { loginId, password, name, phone, email, storeCode, birthdate } = parsed.data;
  const [store] = await db.select().from(adminUsersTable)
    .where(and(eq(adminUsersTable.loginId, storeCode), eq(adminUsersTable.role, "store")));
  if (!store) { res.status(400).json({ error: "유효하지 않은 매장코드입니다" }); return; }
  const [existing] = await db.select().from(membersTable).where(eq(membersTable.loginId, loginId));
  if (existing) { res.status(409).json({ error: "이미 사용중인 아이디입니다" }); return; }
  const [m] = await db.insert(membersTable).values({
    loginId,
    passwordHash: simpleHash(password),
    name,
    phone,
    email: email ?? null,
    storeCode,
    storeId: store.id,
    birthdate: birthdate ?? null,
    isVerified: true,
  }).returning();
  await db.insert(virtualAccountsTable).values({
    accountNumber: generateAccountNumber(),
    bankName: BANKS[Math.floor(Math.random() * BANKS.length)],
    status: "active",
    memberId: m.id,
  });
  res.status(201).json(await formatMember(m));
});

router.get("/members/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatMember(m));
});

router.patch("/members/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates: Partial<typeof membersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email ?? undefined;
  if (parsed.data.birthdate !== undefined) updates.birthdate = parsed.data.birthdate ?? undefined;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  const [m] = await db.update(membersTable).set(updates).where(eq(membersTable.id, id)).returning();
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatMember(m));
});

router.patch("/members/:id/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateMemberStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  await db.update(membersTable).set({ isActive: parsed.data.isActive }).where(eq(membersTable.id, id));
  res.json({ success: true });
});

router.post("/members/:id/virtual-account", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(virtualAccountsTable).set({ status: "revoked" }).where(eq(virtualAccountsTable.memberId, id));
  await db.insert(virtualAccountsTable).values({
    accountNumber: generateAccountNumber(),
    bankName: BANKS[Math.floor(Math.random() * BANKS.length)],
    status: "active",
    memberId: id,
  });
  res.json(await formatMember(m));
});

router.delete("/members/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.update(virtualAccountsTable).set({ status: "revoked" }).where(eq(virtualAccountsTable.memberId, id));
  await db.delete(membersTable).where(eq(membersTable.id, id));
  res.status(204).send();
});

export default router;
