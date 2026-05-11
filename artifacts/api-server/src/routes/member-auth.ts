import { Router } from "express";
import { db, membersTable, virtualAccountsTable, adminUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

export default router;
