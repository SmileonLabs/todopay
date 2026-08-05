import crypto from "node:crypto";
import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  integrationMappingsTable,
  memberRegistrationSessionsTable,
  membersTable,
} from "@workspace/db";
import { hashPassword } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { allowRequest } from "../lib/rate-limit.js";
import { requestTodoPay, TodoPayClientError } from "../lib/todopay-client.js";

const router = Router();

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeTokenMatches(token: string, expectedHash: string): boolean {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return false;
  const actual = Buffer.from(digest(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeBirthdate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
    : null;
}

function upstreamError(error: TodoPayClientError): { status: number; body: Record<string, unknown> } {
  const payload = typeof error.payload === "object" && error.payload !== null
    ? error.payload as Record<string, unknown>
    : {};
  return {
    status: error.status >= 400 && error.status < 500 ? error.status : 502,
    body: {
      error: typeof payload.error === "string" ? payload.error : "본인계좌 인증기관 연결에 실패했습니다.",
      code: typeof payload.code === "string" ? payload.code : "TODOPAY_ERROR",
      ...(typeof payload.attemptsRemaining === "number" ? { attemptsRemaining: payload.attemptsRemaining } : {}),
    },
  };
}

async function sessionFromRequest(publicId: string, token: string) {
  const [session] = await db.select().from(memberRegistrationSessionsTable)
    .where(eq(memberRegistrationSessionsTable.publicId, publicId)).limit(1);
  return session && safeTokenMatches(token, session.tokenHash) ? session : null;
}

router.post("/member/registrations", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const requestIp = (req.ip ?? "unknown").replace(/^::ffff:/, "");
  if (!await allowRequest("member-registration", requestIp, { limit: 10, windowSeconds: 3600 })) {
    res.status(429).json({ error: "가입 인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
    return;
  }
  const input = req.body as Record<string, unknown>;
  const loginId = typeof input.loginId === "string" ? input.loginId.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.replace(/\D/g, "") : "";
  const storeCode = typeof input.storeCode === "string" ? input.storeCode.trim() : "";
  const birthdate = normalizeBirthdate(input.birthdate);
  const withdrawBankCode = typeof input.withdrawBankCode === "string" ? input.withdrawBankCode.trim() : "";
  const withdrawAccount = typeof input.withdrawAccount === "string" ? input.withdrawAccount.replace(/\D/g, "") : "";

  if (!/^[A-Za-z0-9_-]{4,30}$/.test(loginId)
    || password.length < 8 || password.length > 72
    || !name || name.length > 50
    || !/^01[016789]\d{7,8}$/.test(phone)
    || !storeCode || !birthdate
    || !/^\d{3}$/.test(withdrawBankCode)
    || !/^\d{6,20}$/.test(withdrawAccount)) {
    res.status(400).json({ error: "회원 정보와 본인계좌 정보를 모두 정확히 입력해 주세요." });
    return;
  }
  const [[store], [existing]] = await Promise.all([
    db.select().from(adminUsersTable).where(and(
      eq(adminUsersTable.loginId, storeCode),
      eq(adminUsersTable.role, "store"),
      eq(adminUsersTable.isActive, true),
    )).limit(1),
    db.select({ id: membersTable.id }).from(membersTable)
      .where(eq(membersTable.loginId, loginId)).limit(1),
  ]);
  if (!store) {
    res.status(400).json({ error: "유효하지 않은 매장 코드입니다." });
    return;
  }
  if (existing) {
    res.status(409).json({ error: "이미 사용 중인 아이디입니다.", code: "LOGIN_ID_EXISTS" });
    return;
  }

  const publicId = crypto.randomUUID();
  const registrationToken = crypto.randomBytes(32).toString("base64url");
  const [localMember] = await db.insert(membersTable).values({
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
  if (!localMember) {
    res.status(409).json({ error: "이미 사용 중인 아이디입니다.", code: "LOGIN_ID_EXISTS" });
    return;
  }
  const [session] = await db.insert(memberRegistrationSessionsTable).values({
    publicId,
    localMemberId: localMember.id,
    tokenHash: digest(registrationToken),
    status: "starting",
  }).returning();

  let upstreamRegistrationId: string | null = null;
  try {
    const upstream = await requestTodoPay("/member-registrations", {
      method: "POST",
      requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
      body: {
        registrationKey: publicId,
        loginId,
        password,
        name,
        phone,
        birthdate,
        withdrawBankCode,
        withdrawAccount,
      },
    }) as {
      registrationId: number | string;
      memberId: number | string;
      status: string;
      expiresAt: string;
    };
    if (!upstream.registrationId || !upstream.memberId || upstream.status !== "awaiting_verification") {
      throw new Error("TodoPay returned an invalid registration state");
    }
    upstreamRegistrationId = String(upstream.registrationId);
    await db.transaction(async (tx) => {
      await tx.insert(integrationMappingsTable).values({
        localEntityType: "member",
        localEntityId: localMember.id,
        todoPayEntityType: "member",
        todoPayEntityId: String(upstream.memberId),
        syncStatus: "pending_verification",
      });
      await tx.update(memberRegistrationSessionsTable).set({
        todoPayMemberId: String(upstream.memberId),
        todoPayRegistrationId: String(upstream.registrationId),
        status: "awaiting_verification",
        expiresAt: new Date(upstream.expiresAt),
        updatedAt: new Date(),
      }).where(eq(memberRegistrationSessionsTable.id, session.id));
    });
    res.status(201).json({
      registrationId: publicId,
      registrationToken,
      status: "awaiting_verification",
      expiresAt: upstream.expiresAt,
    });
  } catch (error) {
    if (upstreamRegistrationId) {
      try {
        await requestTodoPay(`/member-registrations/${encodeURIComponent(upstreamRegistrationId)}/cancel`, {
          method: "POST",
          requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
          body: {},
        });
      } catch (compensationError) {
        logger.error({ err: compensationError, upstreamRegistrationId }, "TodoPay registration compensation failed");
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(memberRegistrationSessionsTable).where(eq(memberRegistrationSessionsTable.id, session.id));
      await tx.delete(membersTable).where(eq(membersTable.id, localMember.id));
    });
    if (error instanceof TodoPayClientError) {
      const mapped = upstreamError(error);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    logger.error({ err: error, loginId }, "member registration orchestration failed");
    res.status(502).json({ error: "가입 인증을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
});

router.get("/member/registrations/:id", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.get("X-Registration-Token") ?? "";
  const session = await sessionFromRequest(req.params.id, token);
  if (!session) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (!session.todoPayRegistrationId) {
    res.json({ status: session.status, expiresAt: session.expiresAt?.toISOString() ?? null });
    return;
  }
  try {
    const upstream = await requestTodoPay(`/member-registrations/${encodeURIComponent(session.todoPayRegistrationId)}`);
    res.json(upstream);
  } catch (error) {
    if (error instanceof TodoPayClientError) {
      const mapped = upstreamError(error);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    res.status(502).json({ error: "가입 인증 상태를 확인하지 못했습니다." });
  }
});

router.post("/member/registrations/:id/confirm", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.get("X-Registration-Token") ?? "";
  const session = await sessionFromRequest(req.params.id, token);
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!session || !session.todoPayRegistrationId) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (!/^\d{4}$/.test(code)) {
    res.status(400).json({ error: "1원 입금자명의 숫자 4자리를 입력해 주세요." });
    return;
  }
  if (session.status === "completed") {
    res.json({ status: "issued", memberId: session.todoPayMemberId });
    return;
  }
  const [claimedSession] = await db.update(memberRegistrationSessionsTable).set({
    status: "confirming",
    updatedAt: new Date(),
  }).where(and(
    eq(memberRegistrationSessionsTable.id, session.id),
    eq(memberRegistrationSessionsTable.status, "awaiting_verification"),
  )).returning();
  if (!claimedSession) {
    res.status(409).json({
      error: "Registration is already being processed or cannot be confirmed.",
      code: "REGISTRATION_STATE_CONFLICT",
    });
    return;
  }

  try {
    const upstream = await requestTodoPay(
      `/member-registrations/${encodeURIComponent(session.todoPayRegistrationId)}/confirm`,
      {
        method: "POST",
        requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
        body: { code },
      },
    ) as {
      status: string;
      memberId: number | string;
      virtualAccount: { id: number; bankName: string; accountNumber: string; status: string } | null;
    };
    if (upstream.status !== "issued" || !upstream.virtualAccount) {
      throw new Error("TodoPay did not issue a virtual account");
    }
    await db.transaction(async (tx) => {
      await tx.update(membersTable).set({ isActive: true, isVerified: true })
        .where(eq(membersTable.id, session.localMemberId));
      await tx.update(integrationMappingsTable).set({
        syncStatus: "active",
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(integrationMappingsTable.localEntityType, "member"),
        eq(integrationMappingsTable.localEntityId, session.localMemberId),
      ));
      await tx.update(memberRegistrationSessionsTable).set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
        lastErrorCode: null,
      }).where(eq(memberRegistrationSessionsTable.id, session.id));
    });
    res.json(upstream);
  } catch (error) {
    if (error instanceof TodoPayClientError) {
      const mapped = upstreamError(error);
      const attempts = typeof mapped.body.attemptsRemaining === "number"
        ? 5 - mapped.body.attemptsRemaining
        : session.verificationAttempts;
      await db.update(memberRegistrationSessionsTable).set({
        verificationAttempts: attempts,
        lastErrorCode: typeof mapped.body.code === "string" ? mapped.body.code : "TODOPAY_ERROR",
        status: mapped.body.code === "TOO_MANY_ATTEMPTS" ? "failed" : "awaiting_verification",
        updatedAt: new Date(),
      }).where(and(
        eq(memberRegistrationSessionsTable.id, session.id),
        eq(memberRegistrationSessionsTable.status, "confirming"),
      ));
      res.status(mapped.status).json(mapped.body);
      return;
    }
    await db.update(memberRegistrationSessionsTable).set({
      status: "reconciliation_required",
      lastErrorCode: "CONFIRMATION_RESULT_UNKNOWN",
      updatedAt: new Date(),
    }).where(and(
      eq(memberRegistrationSessionsTable.id, session.id),
      eq(memberRegistrationSessionsTable.status, "confirming"),
    ));
    logger.error({ err: error, registrationId: session.publicId }, "member registration confirmation failed");
    res.status(502).json({ error: "가상계좌 발급 완료 상태를 저장하지 못했습니다. 다시 확인해 주세요." });
  }
});

router.post("/member/registrations/:id/cancel", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.get("X-Registration-Token") ?? "";
  const session = await sessionFromRequest(req.params.id, token);
  if (!session || !session.todoPayRegistrationId) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (session.status === "completed") {
    res.status(409).json({ error: "이미 완료된 가입은 취소할 수 없습니다." });
    return;
  }
  const [claimedSession] = await db.update(memberRegistrationSessionsTable).set({
    status: "cancelling",
    updatedAt: new Date(),
  }).where(and(
    eq(memberRegistrationSessionsTable.id, session.id),
    inArray(memberRegistrationSessionsTable.status, ["awaiting_verification", "failed"]),
  )).returning();
  if (!claimedSession) {
    res.status(409).json({
      error: "Registration is already being processed or cannot be cancelled.",
      code: "REGISTRATION_STATE_CONFLICT",
    });
    return;
  }
  try {
    await requestTodoPay(`/member-registrations/${encodeURIComponent(session.todoPayRegistrationId)}/cancel`, {
      method: "POST",
      requestId: req.get("X-Request-Id") ?? crypto.randomUUID(),
      body: {},
    });
    await db.transaction(async (tx) => {
      await tx.delete(integrationMappingsTable).where(and(
        eq(integrationMappingsTable.localEntityType, "member"),
        eq(integrationMappingsTable.localEntityId, session.localMemberId),
      ));
      await tx.update(memberRegistrationSessionsTable).set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(memberRegistrationSessionsTable.id, session.id));
      await tx.delete(membersTable).where(eq(membersTable.id, session.localMemberId));
    });
    res.status(204).end();
  } catch (error) {
    if (error instanceof TodoPayClientError) {
      await db.update(memberRegistrationSessionsTable).set({
        status: session.status,
        updatedAt: new Date(),
      }).where(and(
        eq(memberRegistrationSessionsTable.id, session.id),
        eq(memberRegistrationSessionsTable.status, "cancelling"),
      ));
      const mapped = upstreamError(error);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    await db.update(memberRegistrationSessionsTable).set({
      status: "reconciliation_required",
      lastErrorCode: "CANCELLATION_RESULT_UNKNOWN",
      updatedAt: new Date(),
    }).where(and(
      eq(memberRegistrationSessionsTable.id, session.id),
      eq(memberRegistrationSessionsTable.status, "cancelling"),
    ));
    res.status(502).json({ error: "가입 인증을 취소하지 못했습니다." });
  }
});

export default router;
