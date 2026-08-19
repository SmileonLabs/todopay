import { Router } from "express";
import { db, membersTable, virtualAccountsTable, adminUsersTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod/v4";
import { hashPassword, requireMember, signMemberToken, verifyPassword } from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { allowRequest } from "../lib/rate-limit.js";
import { clearMemberSessionCookie, setMemberSessionCookie } from "../lib/session-cookie.js";

const router = Router();

const memberLoginBody = z.object({
  loginId: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
}).strict();

const depositRequestBody = z.object({
  amount: z.coerce.number().finite().positive().min(1000).max(1_000_000_000),
  fromBank: z.string().trim().max(60).optional(),
  fromAccount: z.string().trim().min(4).max(64),
}).strict();

async function getMemberWithAccount(memberId: number) {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
  if (!member) return null;
  const [account] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, memberId));
  return { member, account: account ?? null };
}

router.get("/member/store-check", async (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(3).max(64) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ valid: false }); return; }
  const { code } = parsed.data;
  const [store] = await db.select().from(adminUsersTable)
    .where(and(eq(adminUsersTable.loginId, code), eq(adminUsersTable.role, "store")));
  if (!store) { res.json({ valid: false }); return; }
  res.json({ valid: true, storeName: store.name });
});

router.post("/member/auth/login", async (req, res) => {
  const parsed = memberLoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { loginId, password } = parsed.data;

  if (!(await allowRequest("member-login", `${req.ip ?? "unknown"}:${loginId}`, { limit: 10, windowSeconds: 15 * 60 }))) {
    res.status(429).json({ error: "Too many login attempts" });
    return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.loginId, loginId));
  if (!member || !member.isActive) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    return;
  }
  if (!(await verifyPassword(password, member.passwordHash))) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    return;
  }
  if (!member.passwordHash.startsWith("scrypt:")) {
    await db.update(membersTable).set({ passwordHash: await hashPassword(password) }).where(eq(membersTable.id, member.id));
  }
  const token = signMemberToken(member.id, member.loginId);
  setMemberSessionCookie(res, token);
  await writeAuditLog(req, { actorId: member.id, actorType: "member", action: "member.login", resourceType: "member", resourceId: member.id });
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
          status: account.status,
        }
      : null,
  });
});

router.post("/member/auth/logout", async (_req, res) => {
  clearMemberSessionCookie(res);
  res.json({ success: true });
});

router.get("/member/auth/me", async (req, res) => {
  const member = await requireMember(req.headers.authorization);
  if (!member) { res.status(401).json({ error: "Unauthorized" }); return; }
  const result = await getMemberWithAccount(member.id);
  if (!result) { res.status(401).json({ error: "Member not found" }); return; }
  const { account } = result;
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
            status: account.status,
          }
        : null,
  });
});

async function getMemberFromToken(authHeader: string | undefined) {
  return requireMember(authHeader);
}

function generateId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
}

// 구매 신청 (구 입금 신청) — 회원이 가상계좌로 구매금액 입금 요청
router.post("/member/deposit-request", async (req, res) => {
  const member = await getMemberFromToken(req.headers.authorization);
  if (!member) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!member.merchantId || !member.storeId) {
    res.status(409).json({ error: "회원의 가맹점 원장 매핑이 완료되지 않았습니다" }); return;
  }
  if (!(await allowRequest("member-deposit", `${req.ip ?? "unknown"}:${member.id}`, { limit: 10, windowSeconds: 60 }))) {
    res.status(429).json({ error: "Too many deposit requests" }); return;
  }

  const parsed = depositRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { amount, fromBank, fromAccount } = parsed.data;
  const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
  if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    res.status(400).json({ error: "Invalid Idempotency-Key" }); return;
  }

  // A retry must return the first result instead of creating another deposit request.
  if (idempotencyKey) {
    const [existing] = await db.select().from(transactionsTable).where(eq(transactionsTable.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) {
      if (existing.memberId !== member.id) { res.status(409).json({ error: "Idempotency key already used" }); return; }
      res.status(200).json({
        id: existing.id,
        trackingNumber: existing.trackingNumber,
        amount: Number(existing.amount),
        status: existing.status,
        fromAccount: existing.fromAccount,
        toAccount: existing.toAccount,
        createdAt: existing.createdAt.toISOString(),
      });
      return;
    }
  }

  const [va] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, member.id));
  if (!va) { res.status(400).json({ error: "발급된 가상계좌가 없습니다" }); return; }
  if (va.status === "revoked") { res.status(400).json({ error: "비활성화된 가상계좌입니다" }); return; }

  // 대기 중인 구매 신청이 5건 이상이면 추가 신청 차단
  const [{ pendingCount }] = await db.select({
    pendingCount: sql<number>`count(*)`,
  }).from(transactionsTable).where(
    and(eq(transactionsTable.memberId, member.id), eq(transactionsTable.status, "pending"), eq(transactionsTable.type, "deposit"))
  );
  if (Number(pendingCount) >= 5) {
    res.status(400).json({ error: "대기 중인 구매 신청이 너무 많습니다. 기존 신청 처리 후 다시 시도해주세요." }); return;
  }

  const fromAccountStr = fromBank ? `${fromBank} ${fromAccount}` : fromAccount;

  let tx;
  try {
    [tx] = await db.insert(transactionsTable).values({
      type: "deposit",
      originalAmount: Number(amount).toFixed(2),
      amount: Number(amount).toFixed(2),
      fee: "0",
      status: "pending",
      fromAccount: fromAccountStr,
      toAccount: va.accountNumber,
      trackingNumber: generateId("DEP"),
      pgTransactionId: generateId("PG"),
      idempotencyKey,
      memberId: member.id,
      merchantId: member.merchantId,
    }).returning();
  } catch (error) {
    // A concurrent retry can race the lookup above; return the already-created request.
    if (idempotencyKey) {
      const [existing] = await db.select().from(transactionsTable).where(eq(transactionsTable.idempotencyKey, idempotencyKey)).limit(1);
      if (existing?.memberId === member.id) {
        res.status(200).json({ id: existing.id, trackingNumber: existing.trackingNumber, amount: Number(existing.amount), status: existing.status, fromAccount: existing.fromAccount, toAccount: existing.toAccount, createdAt: existing.createdAt.toISOString() });
        return;
      }
    }
    throw error;
  }

  await writeAuditLog(req, { actorId: member.id, actorType: "member", action: "deposit.request", resourceType: "transaction", resourceId: tx.id, metadata: { amount: Number(amount) } });

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

// 구매 내역 조회
router.get("/member/deposits", async (req, res) => {
  const member = await getMemberFromToken(req.headers.authorization);
  if (!member) { res.status(401).json({ error: "Unauthorized" }); return; }

  const deposits = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.memberId, member.id), eq(transactionsTable.type, "deposit")))
    .orderBy(sql`${transactionsTable.createdAt} desc`)
    .limit(30);

  res.json({
    items: deposits.map(t => ({
      id: t.id,
      amount: Number(t.amount),
      originalAmount: Number(t.originalAmount),
      fee: Number(t.fee),
      status: t.status,
      trackingNumber: t.trackingNumber,
      fromAccount: t.fromAccount,
      toAccount: t.toAccount,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export default router;
