import crypto from "node:crypto";
import { Router } from "express";
import {
  adminUsersTable,
  db,
  integrationMappingsTable,
  membersTable,
  transactionsTable,
  virtualAccountsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  checkRateLimit,
  hashPassword,
  isLegacyPasswordHash,
  isTokenInvalidated,
  resetRateLimit,
  signMemberToken,
  verifyMemberToken,
  verifyPassword,
} from "../lib/auth.js";
import { requireLegacyFinancialWrites } from "../lib/integration-gate.js";
import { allowRequest } from "../lib/rate-limit.js";
import { logger } from "../lib/logger.js";
import {
  requestTodoPay,
  TodoPayClientError,
} from "../lib/todopay-client.js";

const router = Router();

function normalizeBirthdate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return undefined;

  const normalized = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return undefined;
  return normalized;
}

async function getMemberWithAccount(memberId: number) {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
  if (!member) return null;
  const [mapping] = await db.select().from(integrationMappingsTable).where(and(
    eq(integrationMappingsTable.localEntityType, "member"),
    eq(integrationMappingsTable.localEntityId, memberId),
  )).limit(1);
  if (mapping?.todoPayEntityId && mapping.syncStatus === "active") {
    try {
      const remote = await requestTodoPay(`/members/${encodeURIComponent(mapping.todoPayEntityId)}`) as {
        virtualAccount?: { id: number; bankName: string; accountNumber: string; status: string } | null;
      };
      return { member, account: remote.virtualAccount ?? null };
    } catch (error) {
      logger.error({ err: error, memberId }, "TodoPay member account read failed");
      throw error;
    }
  }
  const [account] = await db.select().from(virtualAccountsTable).where(eq(virtualAccountsTable.memberId, memberId));
  return { member, account: account ?? null };
}

router.get("/member/store-check", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
  if (!code) { res.status(400).json({ valid: false }); return; }
  const [store] = await db.select().from(adminUsersTable)
    .where(and(
      eq(adminUsersTable.loginId, code),
      eq(adminUsersTable.role, "store"),
      eq(adminUsersTable.isActive, true),
    ));
  if (!store) { res.json({ valid: false }); return; }
  res.json({ valid: true, storeName: store.name });
});

router.post("/members/register", async (req, res) => {
  res.status(410).json({
    error: "정식 1원 인증 가입 화면을 이용해 주세요.",
    code: "MEMBER_REGISTRATION_REQUIRED",
  });
  return;
  /*
  const requestIp = (req.ip ?? "unknown").replace(/^::ffff:/, "");
  if (!await allowRequest("member-register", requestIp, { limit: 20, windowSeconds: 3600 })) {
    res.status(429).json({ error: "가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  const input = req.body as Record<string, unknown>;
  const loginId = typeof input.loginId === "string" ? input.loginId.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.replace(/\D/g, "") : "";
  const storeCode = typeof input.storeCode === "string" ? input.storeCode.trim() : "";
  const birthdate = normalizeBirthdate(input.birthdate);

  if (!/^[A-Za-z0-9_-]{4,30}$/.test(loginId)) {
    res.status(400).json({ error: "아이디는 영문, 숫자, 밑줄, 하이픈으로 4~30자까지 입력해주세요." });
    return;
  }
  if (password.length < 8 || password.length > 72) {
    res.status(400).json({ error: "비밀번호는 8~72자로 입력해주세요." });
    return;
  }
  if (!name || name.length > 50) {
    res.status(400).json({ error: "이름은 1~50자로 입력해주세요." });
    return;
  }
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    res.status(400).json({ error: "올바른 휴대폰 번호를 입력해주세요." });
    return;
  }
  if (!storeCode) {
    res.status(400).json({ error: "매장 코드를 입력해주세요." });
    return;
  }
  if (birthdate === undefined) {
    res.status(400).json({ error: "생년월일은 YYYY-MM-DD 또는 숫자 8자리로 입력해주세요." });
    return;
  }

  const [store] = await db.select().from(adminUsersTable)
    .where(and(
      eq(adminUsersTable.loginId, storeCode),
      eq(adminUsersTable.role, "store"),
      eq(adminUsersTable.isActive, true),
    ));
  if (!store) {
    res.status(400).json({ error: "유효하지 않은 매장 코드입니다." });
    return;
  }

  const [existing] = await db.select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.loginId, loginId))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
    return;
  }

  // Reserve the local login before calling TodoPay. The inactive reservation
  // prevents a user from logging in until both systems are linked.
  const [reserved] = await db.insert(membersTable).values({
    loginId,
    passwordHash: await hashPassword(password),
    name,
    phone,
    storeCode,
    storeId: store.id,
    birthdate,
    isVerified: false,
    isActive: false,
  }).onConflictDoNothing({ target: membersTable.loginId }).returning();

  if (!reserved) {
    res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
    return;
  }

  let todoPayMember: { id: number | string };
  try {
    todoPayMember = await requestTodoPay("/members", {
      method: "POST",
      requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
      body: { loginId, password, name, phone },
    }) as { id: number | string };
    if (!todoPayMember?.id) throw new Error("TodoPay member response did not include an id");
  } catch (error) {
    await db.delete(membersTable).where(eq(membersTable.id, reserved.id));
    if (error instanceof TodoPayClientError) {
      if (error.status === 409) {
        const upstreamMessage = typeof error.payload === "object" && error.payload !== null
          && "error" in error.payload && typeof error.payload.error === "string"
          ? error.payload.error
          : "";
        if (upstreamMessage === "Merchant ledger store is not configured") {
          res.status(503).json({ error: "TodoPay 회원 귀속 매장 설정이 필요합니다." });
          return;
        }
        res.status(409).json({ error: "TodoPay에 이미 사용 중인 아이디입니다." });
        return;
      }
      if (error.status === 400) {
        res.status(400).json({ error: "회원 정보를 다시 확인해주세요." });
        return;
      }
      logger.error({ err: error, loginId }, "TodoPay member registration failed");
      res.status(502).json({ error: "TodoPay 회원 등록에 실패했습니다. 잠시 후 다시 시도해주세요." });
      return;
    }
    logger.error({ err: error, loginId }, "TodoPay member registration returned an invalid response");
    res.status(502).json({ error: "TodoPay 회원 등록 응답을 확인할 수 없습니다." });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(integrationMappingsTable).values({
        localEntityType: "member",
        localEntityId: reserved.id,
        todoPayEntityType: "member",
        todoPayEntityId: String(todoPayMember.id),
        syncStatus: "active",
        lastVerifiedAt: new Date(),
      });
      await tx.update(membersTable)
        .set({ isActive: true })
        .where(eq(membersTable.id, reserved.id));
    });
  } catch (error) {
    try {
      await requestTodoPay(`/members/${encodeURIComponent(String(todoPayMember.id))}`, {
        method: "PATCH",
        requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
        body: { isActive: false },
      });
    } catch (compensationError) {
      logger.error(
        { err: compensationError, todoPayMemberId: todoPayMember.id },
        "TodoPay member compensation failed",
      );
    }
    await db.delete(membersTable).where(eq(membersTable.id, reserved.id));
    logger.error({ err: error, loginId }, "Sellink member mapping failed");
    res.status(502).json({ error: "회원 연동을 완료하지 못했습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  res.status(201).json({
    id: reserved.id,
    loginId: reserved.loginId,
    name: reserved.name,
  });
  */
});

router.post("/member/auth/login", async (req, res) => {
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId || !password) {
    res.status(400).json({ error: "아이디와 비밀번호를 입력해주세요" });
    return;
  }
  const requestIp = (req.ip ?? "unknown").replace(/^::ffff:/, "");
  const [accountAllowed, ipAllowed] = await Promise.all([
    checkRateLimit(`member-account:${loginId.toLowerCase()}`),
    checkRateLimit(`member-ip:${requestIp}`, 100),
  ]);
  if (!accountAllowed || !ipAllowed) {
    res.status(429).json({ error: "로그인 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요." });
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
  await resetRateLimit(`member-account:${loginId.toLowerCase()}`);
  if (isLegacyPasswordHash(member.passwordHash)) {
    await db.update(membersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(membersTable.id, member.id));
  }
  const token = signMemberToken(member.id, member.loginId);
  const result = await getMemberWithAccount(member.id);
  const account = result?.account ?? null;
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
    token,
  });
});

router.get("/member/auth/me", async (req, res) => {
  const parsedToken = verifyMemberToken(req.headers.authorization);
  if (!parsedToken || await isTokenInvalidated(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await getMemberWithAccount(parsedToken.id);
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
            status: account.status,
          }
        : null,
    });
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

async function getMemberFromToken(authHeader: string | undefined) {
  const parsedToken = verifyMemberToken(authHeader);
  if (!parsedToken || await isTokenInvalidated(authHeader)) return null;
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, parsedToken.id));
  if (!member || !member.isActive || member.loginId !== parsedToken.loginId) return null;
  return member;
}

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
}

// 구매 신청 (구 입금 신청) — 회원이 가상계좌로 구매금액 입금 요청
router.post("/member/deposit-request", async (req, res) => {
  if (!requireLegacyFinancialWrites(res)) return;
  const member = await getMemberFromToken(req.headers.authorization);
  if (!member) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { amount, fromBank, fromAccount } = req.body as { amount?: number; fromBank?: string; fromAccount?: string };
  if (!amount || Number(amount) <= 0) { res.status(400).json({ error: "금액을 올바르게 입력해주세요" }); return; }
  if (Number(amount) < 1000) { res.status(400).json({ error: "최소 구매금액은 1,000원입니다" }); return; }
  if (!fromAccount?.trim()) { res.status(400).json({ error: "계좌번호를 입력해주세요" }); return; }

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
