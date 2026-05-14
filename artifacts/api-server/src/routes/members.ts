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
  // 날짜 prefix(6자리) + 랜덤(5자리)로 충돌 확률 대폭 감소
  const datePart = new Date().toISOString().slice(2, 8).replace(/-/g, ""); // YYMMDD
  const randPart = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join("");
  return `${datePart}${randPart}`;
}

async function getAdminFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    if (isNaN(id)) return null;
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
    return (user && user.isActive) ? user : null;
  } catch {
    return null;
  }
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

// GET /members/register-link — admin only
router.get("/members/register-link", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  res.json({ url: `https://${baseUrl}/register/member` });
});

// GET /members — admin only
router.get("/members", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

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

// POST /members — 회원 등록 (회원 자기 등록 또는 어드민 등록)
// 회원 INSERT + 가상계좌 INSERT를 트랜잭션으로 묶어 원자적 처리
router.post("/members", async (req, res) => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { loginId, password, name, phone, email, storeCode, birthdate } = parsed.data;

  if (!storeCode?.trim()) {
    res.status(400).json({ error: "매장코드는 필수입니다" }); return;
  }

  const [store] = await db.select().from(adminUsersTable)
    .where(and(eq(adminUsersTable.loginId, storeCode), eq(adminUsersTable.role, "store")));
  if (!store) { res.status(400).json({ error: "유효하지 않은 매장코드입니다" }); return; }

  const [existing] = await db.select().from(membersTable).where(eq(membersTable.loginId, loginId));
  if (existing) { res.status(409).json({ error: "이미 사용중인 아이디입니다" }); return; }

  // 회원 + 가상계좌를 트랜잭션으로 묶어 원자적 생성
  let createdMember: typeof membersTable.$inferSelect | null = null;

  await db.transaction(async (dbtx) => {
    const [m] = await dbtx.insert(membersTable).values({
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

    await dbtx.insert(virtualAccountsTable).values({
      accountNumber: generateAccountNumber(),
      bankName: BANKS[Math.floor(Math.random() * BANKS.length)],
      status: "active",
      memberId: m.id,
    });

    createdMember = m;
  });

  if (!createdMember) {
    res.status(500).json({ error: "회원 등록 중 오류가 발생했습니다" }); return;
  }

  res.status(201).json(await formatMember(createdMember));
});

// GET /members/:id — admin only
router.get("/members/:id", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatMember(m));
});

// PATCH /members/:id — admin only
router.patch("/members/:id", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates: Partial<typeof membersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email ?? undefined;
  if (parsed.data.birthdate !== undefined) updates.birthdate = parsed.data.birthdate ?? undefined;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "변경할 항목이 없습니다" }); return; }
  const [m] = await db.update(membersTable).set(updates).where(eq(membersTable.id, id)).returning();
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatMember(m));
});

// PATCH /members/:id/status — admin only
router.patch("/members/:id/status", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateMemberStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [m] = await db.update(membersTable)
    .set({ isActive: parsed.data.isActive })
    .where(eq(membersTable.id, id))
    .returning({ id: membersTable.id });
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

// POST /members/:id/virtual-account — 가상계좌 재발급 (트랜잭션으로 원자적 처리)
router.post("/members/:id/virtual-account", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }

  // 기존 계좌 revoke + 신규 발급을 트랜잭션으로 원자적 처리
  await db.transaction(async (dbtx) => {
    await dbtx.update(virtualAccountsTable)
      .set({ status: "revoked" })
      .where(eq(virtualAccountsTable.memberId, id));
    await dbtx.insert(virtualAccountsTable).values({
      accountNumber: generateAccountNumber(),
      bankName: BANKS[Math.floor(Math.random() * BANKS.length)],
      status: "active",
      memberId: id,
    });
  });

  res.json(await formatMember(m));
});

// DELETE /members/:id — admin only
router.delete("/members/:id", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // 계좌 revoke + 회원 삭제를 트랜잭션으로 처리
  await db.transaction(async (dbtx) => {
    await dbtx.update(virtualAccountsTable)
      .set({ status: "revoked" })
      .where(eq(virtualAccountsTable.memberId, id));
    await dbtx.delete(membersTable).where(eq(membersTable.id, id));
  });

  res.status(204).send();
});

export default router;
