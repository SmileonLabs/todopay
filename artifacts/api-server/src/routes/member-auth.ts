import { Router } from "express";
import { db, membersTable, virtualAccountsTable, adminUsersTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

function simpleHash(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

async function getMemberWithAccount(memberId: number) {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
  if (!member) return null;
  const [account] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, memberId));
  return { member, account: account ?? null };
}

router.get("/member/store-check", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) { res.status(400).json({ valid: false }); return; }
  const [store] = await db.select().from(adminUsersTable)
    .where(and(eq(adminUsersTable.loginId, code), eq(adminUsersTable.role, "store")));
  if (!store) { res.json({ valid: false }); return; }
  res.json({ valid: true, storeName: store.name });
});

router.post("/member/auth/login", async (req, res) => {
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId || !password) {
    res.status(400).json({ error: "아이디와 비밀번호를 입력해주세요" });
    return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.loginId, loginId));
  if (!member || !member.isActive) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    return;
  }
  const hash = simpleHash(password);
  if (member.passwordHash !== hash) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    return;
  }
  const token = Buffer.from(`m:${member.id}:${member.loginId}:${Date.now()}`).toString("base64");
  const [account] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, member.id));
  res.json({
    member: {
      id: member.id,
      loginId: member.loginId,
      name: member.name,
      phone: member.phone,
      birthdate: member.birthdate ?? null,
      isVerified: member.isVerified,
      createdAt: member.createdAt.toISOString(),
    },
    account: account
      ? {
          id: account.id,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          balance: account.balance,
          status: account.status,
        }
      : null,
    token,
  });
});

router.get("/member/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] !== "m") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const memberId = parseInt(parts[1], 10);
    const result = await getMemberWithAccount(memberId);
    if (!result) {
      res.status(401).json({ error: "Member not found" });
      return;
    }
    const { member, account } = result;
    res.json({
      member: {
        id: member.id,
        loginId: member.loginId,
        name: member.name,
        phone: member.phone,
        birthdate: member.birthdate ?? null,
        isVerified: member.isVerified,
        createdAt: member.createdAt.toISOString(),
      },
      account: account
        ? {
            id: account.id,
            bankName: account.bankName,
            accountNumber: account.accountNumber,
            balance: account.balance,
            status: account.status,
          }
        : null,
    });
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

async function getMemberFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] !== "m") return null;
    const memberId = parseInt(parts[1], 10);
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
    return member ?? null;
  } catch {
    return null;
  }
}

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
}

router.post("/member/deposit-request", async (req, res) => {
  const member = await getMemberFromToken(req.headers.authorization);
  if (!member) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { amount, fromBank, fromAccount } = req.body as { amount?: number; fromBank?: string; fromAccount?: string };
  if (!amount || Number(amount) <= 0) { res.status(400).json({ error: "금액을 올바르게 입력해주세요" }); return; }
  if (!fromAccount?.trim()) { res.status(400).json({ error: "계좌번호를 입력해주세요" }); return; }

  const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, member.id));
  if (!va) { res.status(400).json({ error: "발급된 가상계좌가 없습니다" }); return; }
  if (va.status === "revoked") { res.status(400).json({ error: "비활성화된 가상계좌입니다" }); return; }

  const fromAccountStr = fromBank ? `${fromBank} ${fromAccount.trim()}` : fromAccount.trim();

  const [tx] = await db.insert(transactionsTable).values({
    type: "deposit",
    originalAmount: Number(amount).toFixed(2),
    amount: Number(amount).toFixed(2),
    fee: "0",
    status: "pending",
    fromAccount: fromAccountStr,
    toAccount: va.accountNumber,
    trackingNumber: generateId("DEP"),
    pgTransactionId: generateId("PG"),
    memberId: member.id,
  }).returning();

  res.status(201).json({
    id: tx.id,
    trackingNumber: tx.trackingNumber,
    amount: Number(tx.amount),
    status: tx.status,
    fromAccount: tx.fromAccount,
    toAccount: tx.toAccount,
    createdAt: tx.createdAt.toISOString(),
  });
});

router.get("/member/deposits", async (req, res) => {
  const member = await getMemberFromToken(req.headers.authorization);
  if (!member) { res.status(401).json({ error: "Unauthorized" }); return; }

  const deposits = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.memberId, member.id), eq(transactionsTable.type, "deposit")))
    .orderBy(sql`${transactionsTable.createdAt} desc`)
    .limit(30);

  const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, member.id));

  res.json({
    balance: va ? Number(va.balance) : 0,
    items: deposits.map(t => ({
      id: t.id,
      amount: Number(t.amount),
      status: t.status,
      trackingNumber: t.trackingNumber,
      fromAccount: t.fromAccount,
      toAccount: t.toAccount,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export default router;
