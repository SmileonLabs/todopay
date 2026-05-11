import { Router } from "express";
import { db, buyersTable, virtualAccountsTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte } from "drizzle-orm";
import { ListBuyersQueryParams, CreateBuyerBody } from "@workspace/api-zod";

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

async function formatBuyer(b: typeof buyersTable.$inferSelect) {
  const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.buyerId, b.id));
  return {
    id: b.id,
    name: b.name,
    loginId: b.loginId,
    phone: b.phone,
    birthdate: b.birthdate,
    isVerified: b.isVerified,
    virtualAccountNumber: va?.accountNumber ?? "",
    virtualAccountBank: va?.bankName ?? "",
    virtualAccountStatus: va?.status ?? "revoked",
    withdrawalAccount: b.withdrawalAccount ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

router.get("/buyers", async (req, res) => {
  const parsed = ListBuyersQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.search) {
    conditions.push(or(
      ilike(buyersTable.name, `%${params.search}%`),
      ilike(buyersTable.loginId, `%${params.search}%`),
      ilike(buyersTable.phone, `%${params.search}%`)
    )!);
  }
  if (params.startDate) conditions.push(gte(buyersTable.createdAt, new Date(params.startDate)));
  if (params.endDate) conditions.push(lte(buyersTable.createdAt, new Date(params.endDate)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [buyers, [{ count }]] = await Promise.all([
    db.select().from(buyersTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(buyersTable).where(where),
  ]);
  const formatted = await Promise.all(buyers.map(formatBuyer));
  res.json({ items: formatted, total: Number(count) });
});

router.post("/buyers", async (req, res) => {
  const parsed = CreateBuyerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { name, loginId, password, phone, birthdate } = parsed.data;
  const [b] = await db.insert(buyersTable).values({
    name, loginId, passwordHash: simpleHash(password), phone, birthdate, isVerified: true,
  }).returning();
  await db.insert(virtualAccountsTable).values({
    accountNumber: generateAccountNumber(),
    bankName: BANKS[Math.floor(Math.random() * BANKS.length)],
    status: "active",
    buyerId: b.id,
  });
  res.status(201).json(await formatBuyer(b));
});

router.get("/buyers/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [b] = await db.select().from(buyersTable).where(eq(buyersTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatBuyer(b));
});

router.delete("/buyers/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.update(virtualAccountsTable).set({ status: "revoked" }).where(eq(virtualAccountsTable.buyerId, id));
  await db.delete(buyersTable).where(eq(buyersTable.id, id));
  res.status(204).send();
});

router.post("/buyers/:id/virtual-account", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [b] = await db.select().from(buyersTable).where(eq(buyersTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(virtualAccountsTable).set({ status: "revoked" }).where(eq(virtualAccountsTable.buyerId, id));
  await db.insert(virtualAccountsTable).values({
    accountNumber: generateAccountNumber(),
    bankName: BANKS[Math.floor(Math.random() * BANKS.length)],
    status: "active",
    buyerId: id,
  });
  res.json(await formatBuyer(b));
});

router.get("/buyers/register-link", (_req, res) => {
  const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  res.json({ url: `https://${baseUrl}/register/buyer` });
});

export default router;
