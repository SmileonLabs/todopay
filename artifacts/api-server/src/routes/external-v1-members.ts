import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  adminUsersTable,
  membersTable,
  merchantFeeConfigsTable,
  moneyLedgerTable,
  paymentIntentEventsTable,
  paymentIntentsTable,
  paymentEventsTable,
  transactionsTable,
  virtualAccountIssuancesTable,
  virtualAccountsTable,
  withdrawalsTable,
} from "@workspace/db";
import { allowRequest } from "../lib/rate-limit.js";
import { hashPassword } from "../lib/auth.js";
import { requireMerchantApi } from "../lib/merchant-api-auth.js";
import { KpPayClient, KpPayError } from "../lib/kp-pay-client.js";
import { logger } from "../lib/logger.js";
import { isPaymentIntentMemberReplay } from "../lib/payment-intent-state.js";
import { createPaymentIntentTrackId } from "../lib/payment-intent-pg-binding.js";
import {
  activeAccountStoreScope,
  bankNames,
  dateValue,
  KPPAY_VIRTUAL_BANK_CODE,
  ledgerStoreScope,
  memberStoreScope,
  normalizeBirthdate,
  pageValue,
  paymentEventStoreScope,
  stableJson,
  storeCodesValue,
  stringValue,
  transactionStoreScope,
  virtualAccountStoreScope,
  withdrawalStoreScope,
} from "./external-v1-helpers.js";

import {
  accountForMember,
  authenticated,
  intentAccount,
  paymentIntentResponse,
  providerFailure,
  registrationResponse,
} from "./external-v1-shared.js";
const router = Router();

router.get("/external/v1/members", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const page = pageValue(req.query.page, 1, 10_000);
  const limit = pageValue(req.query.limit, 50, 100);
  const offset = (page - 1) * limit;
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conditions = [eq(membersTable.merchantId, context.merchant.id)];
  const storeScope = memberStoreScope(storeCodesValue(req));
  if (storeScope) conditions.push(storeScope);
  if (search)
    conditions.push(
      sql`(${membersTable.name} ilike ${`%${search}%`} or ${membersTable.loginId} ilike ${`%${search}%`} or ${membersTable.phone} ilike ${`%${search}%`})`,
    );
  const scope = and(...conditions);
  const [members, [{ count }]] = await Promise.all([
    db
      .select()
      .from(membersTable)
      .where(scope)
      .orderBy(desc(membersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(membersTable)
      .where(scope),
  ]);
  const ids = members.map((member) => member.id);
  const accounts =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(virtualAccountsTable)
          .where(
            and(
              inArray(virtualAccountsTable.memberId, ids),
              eq(virtualAccountsTable.status, "active"),
            ),
          );
  const accountByMember = new Map(
    accounts.map((account) => [account.memberId, account]),
  );
  res.json({
    page,
    limit,
    total: Number(count),
    items: members.map((member) => {
      const account = accountByMember.get(member.id);
      return {
        id: member.id,
        loginId: member.loginId,
        name: member.name,
        phone: member.phone,
        email: member.email ?? null,
        birthdate: member.birthdate ?? null,
        isActive: member.isActive,
        isVerified: member.isVerified,
        virtualAccount: account
          ? {
              bankName: account.bankName,
              accountNumber: account.accountNumber,
              status: account.status,
            }
          : null,
        createdAt: member.createdAt.toISOString(),
      };
    }),
  });
});

/**
 * Starts the production member onboarding flow. KPPay sends KRW 1 to the
 * member's own account and the TodoPay member remains inactive until the
 * four-digit code is confirmed.
 */
router.post("/external/v1/member-registrations", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  if (
    !(await allowRequest(
      "merchant-member-registration",
      `${context.merchant.id}:${req.ip ?? "unknown"}`,
      { limit: 10, windowSeconds: 60 * 60 },
    ))
  ) {
    res
      .status(429)
      .json({
        error: "가입 인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      });
    return;
  }
  if (process.env.PAYMENT_PROVIDER_ENABLED !== "true") {
    res
      .status(503)
      .json({
        error: "실명 인증 서비스를 사용할 수 없습니다.",
        code: "PROVIDER_DISABLED",
      });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const registrationKey = stringValue(body.registrationKey, 64);
  const loginId = stringValue(body.loginId, 50);
  const password = typeof body.password === "string" ? body.password : "";
  const name = stringValue(body.name, 50);
  const phone = stringValue(body.phone, 20).replace(/\D/g, "");
  const email = stringValue(body.email, 200);
  const birthdate = normalizeBirthdate(body.birthdate);
  const withdrawBankCode = stringValue(body.withdrawBankCode, 3);
  const withdrawAccount = stringValue(body.withdrawAccount, 30).replace(
    /\D/g,
    "",
  );

  if (
    !/^[0-9a-f-]{36}$/i.test(registrationKey) ||
    !/^[A-Za-z0-9_.-]{4,50}$/.test(loginId) ||
    password.length < 8 ||
    password.length > 72 ||
    !name ||
    !/^01[016789]\d{7,8}$/.test(phone) ||
    !birthdate ||
    !/^\d{3}$/.test(withdrawBankCode) ||
    !/^\d{6,20}$/.test(withdrawAccount)
  ) {
    res
      .status(400)
      .json({
        error: "회원 또는 본인계좌 정보를 다시 확인해 주세요.",
        code: "INVALID_REGISTRATION",
      });
    return;
  }

  const [existingIssuance] = await db
    .select()
    .from(virtualAccountIssuancesTable)
    .where(
      and(
        eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
        eq(virtualAccountIssuancesTable.idempotencyKey, registrationKey),
      ),
    )
    .limit(1);
  if (existingIssuance) {
    const account =
      existingIssuance.status === "issued"
        ? await accountForMember(existingIssuance.memberId)
        : null;
    res
      .status(existingIssuance.status === "failed" ? 409 : 200)
      .json(registrationResponse(existingIssuance, account));
    return;
  }

  const [duplicate] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.loginId, loginId))
    .limit(1);
  if (duplicate) {
    res
      .status(409)
      .json({ error: "이미 사용 중인 아이디입니다.", code: "LOGIN_ID_EXISTS" });
    return;
  }
  const [ledgerStore] = await db
    .select({
      id: adminUsersTable.id,
      loginId: adminUsersTable.loginId,
    })
    .from(adminUsersTable)
    .where(
      and(
        eq(adminUsersTable.merchantId, context.merchant.id),
        eq(adminUsersTable.role, "store"),
        eq(adminUsersTable.isActive, true),
      ),
    )
    .orderBy(adminUsersTable.id)
    .limit(1);
  if (!ledgerStore) {
    res
      .status(409)
      .json({
        error: "가맹점 원장 매장이 설정되지 않았습니다.",
        code: "LEDGER_STORE_MISSING",
      });
    return;
  }
  const merchantId = process.env.KP_PAY_MERCHANT_ID?.trim() ?? "";
  if (!merchantId) {
    res
      .status(503)
      .json({
        error: "실명 인증 설정이 완료되지 않았습니다.",
        code: "PROVIDER_CONFIG_MISSING",
      });
    return;
  }

  let member: typeof membersTable.$inferSelect | undefined;
  let issuance: typeof virtualAccountIssuancesTable.$inferSelect | undefined;
  try {
    const available = await new KpPayClient().availableVirtualAccounts([
      KPPAY_VIRTUAL_BANK_CODE,
    ]);
    const candidate = available.vact.vacts?.find(
      (item) => item.bankCd === KPPAY_VIRTUAL_BANK_CODE,
    );
    if (!candidate) {
      res
        .status(409)
        .json({
          error: "현재 발급 가능한 가상계좌가 없습니다.",
          code: "NO_VIRTUAL_ACCOUNT",
        });
      return;
    }

    const passwordHash = await hashPassword(password);
    const trackingNumber = `VA-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    [member] = await db
      .insert(membersTable)
      .values({
        loginId,
        passwordHash,
        name,
        phone,
        email: email || null,
        birthdate,
        merchantId: context.merchant.id,
        storeId: ledgerStore.id,
        storeCode: ledgerStore.loginId,
        isVerified: false,
        isActive: false,
      })
      .returning();
    [issuance] = await db
      .insert(virtualAccountIssuancesTable)
      .values({
        merchantId: context.merchant.id,
        memberId: member.id,
        idempotencyKey: registrationKey,
        trackingNumber,
        virtualAccountNumber: candidate.account,
        virtualBankCode: KPPAY_VIRTUAL_BANK_CODE,
        status: "requesting",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning();

    const registration =
      await new KpPayClient().requestVirtualAccountRegistration({
        mchtId: merchantId,
        account: candidate.account,
        withdrawBankCd: withdrawBankCode,
        withdrawAccount,
        identity: birthdate.replace(/\D/g, "").slice(2),
        phoneNo: phone,
        name,
        holderName: context.merchant.name.slice(0, 20),
        trackId: trackingNumber,
        udf1: String(member.id),
        udf2: String(context.merchant.id),
      });
    if (!registration.vact.authNo)
      throw new KpPayError("KPPay verification ID missing", 502);

    const [pending] = await db
      .update(virtualAccountIssuancesTable)
      .set({
        status: "awaiting_verification",
        providerAuthNo: registration.vact.authNo,
        providerIssueId: registration.vact.issueId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(virtualAccountIssuancesTable.id, issuance.id))
      .returning();
    res.status(201).json(registrationResponse(pending));
  } catch (error) {
    if (issuance) {
      await db
        .delete(virtualAccountIssuancesTable)
        .where(eq(virtualAccountIssuancesTable.id, issuance.id));
    }
    if (member) {
      await db
        .delete(membersTable)
        .where(
          and(eq(membersTable.id, member.id), eq(membersTable.isActive, false)),
        );
    }
    providerFailure(res, error, "virtual_account_registration");
  }
});

router.get("/external/v1/member-registrations/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "올바르지 않은 가입 인증 번호입니다." });
    return;
  }
  const [issuance] = await db
    .select()
    .from(virtualAccountIssuancesTable)
    .where(
      and(
        eq(virtualAccountIssuancesTable.id, id),
        eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
      ),
    )
    .limit(1);
  if (!issuance) {
    res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
    return;
  }
  if (
    issuance.status === "awaiting_verification" &&
    issuance.expiresAt &&
    issuance.expiresAt < new Date()
  ) {
    const [expired] = await db
      .update(virtualAccountIssuancesTable)
      .set({
        status: "expired",
        updatedAt: new Date(),
      })
      .where(eq(virtualAccountIssuancesTable.id, issuance.id))
      .returning();
    res.json(registrationResponse(expired));
    return;
  }
  const account =
    issuance.status === "issued"
      ? await accountForMember(issuance.memberId)
      : null;
  res.json(registrationResponse(issuance, account));
});

router.post(
  "/external/v1/member-registrations/:id/confirm",
  async (req, res) => {
    const context = await authenticated(req, res);
    if (!context) return;
    const id = Number(req.params.id);
    const code = stringValue(req.body?.code, 4);
    if (!Number.isSafeInteger(id) || id <= 0 || !/^\d{4}$/.test(code)) {
      res
        .status(400)
        .json({
          error: "1원 입금자명의 숫자 4자리를 입력해 주세요.",
          code: "INVALID_CODE",
        });
      return;
    }
    if (
      !(await allowRequest(
        "merchant-member-confirm",
        `${context.merchant.id}:${id}`,
        { limit: 10, windowSeconds: 10 * 60 },
      ))
    ) {
      res
        .status(429)
        .json({
          error: "인증번호 확인 요청이 너무 많습니다.",
          code: "TOO_MANY_ATTEMPTS",
        });
      return;
    }
    const [issuance] = await db
      .select()
      .from(virtualAccountIssuancesTable)
      .where(
        and(
          eq(virtualAccountIssuancesTable.id, id),
          eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
        ),
      )
      .limit(1);
    if (!issuance) {
      res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
      return;
    }
    if (issuance.status === "issued") {
      res.json(
        registrationResponse(
          issuance,
          await accountForMember(issuance.memberId),
        ),
      );
      return;
    }
    if (issuance.verificationAttempts >= 5) {
      res
        .status(409)
        .json({
          error:
            "인증번호 입력 횟수를 초과했습니다. 가입을 다시 시작해 주세요.",
          code: "TOO_MANY_ATTEMPTS",
        });
      return;
    }
    if (
      issuance.status !== "awaiting_verification" ||
      !issuance.providerAuthNo ||
      !issuance.expiresAt ||
      issuance.expiresAt < new Date()
    ) {
      if (issuance.status === "awaiting_verification") {
        await db
          .update(virtualAccountIssuancesTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(virtualAccountIssuancesTable.id, issuance.id));
      }
      res
        .status(409)
        .json({
          error: "인증 유효시간이 만료되었습니다. 가입을 다시 시작해 주세요.",
          code: "REGISTRATION_EXPIRED",
        });
      return;
    }

    try {
      const confirmation =
        await new KpPayClient().confirmVirtualAccountRegistration({
          mchtId: process.env.KP_PAY_MERCHANT_ID ?? "",
          authNo: issuance.providerAuthNo,
          oneCertiInNo: code,
        });
      await db.transaction(async (tx) => {
        await tx
          .update(virtualAccountsTable)
          .set({ status: "revoked" })
          .where(
            and(
              eq(virtualAccountsTable.memberId, issuance.memberId),
              eq(virtualAccountsTable.status, "active"),
            ),
          );
        const [insertedAccount] = await tx
          .insert(virtualAccountsTable)
          .values({
            accountNumber: confirmation.vact.account,
            bankName:
              bankNames[confirmation.vact.bankCd ?? issuance.virtualBankCode] ??
              confirmation.vact.bankCd ??
              issuance.virtualBankCode,
            status: "active",
            memberId: issuance.memberId,
            merchantId: context.merchant.id,
          })
          .onConflictDoNothing({ target: virtualAccountsTable.accountNumber })
          .returning();
        if (!insertedAccount) {
          const [ownedAccount] = await tx
            .select({ id: virtualAccountsTable.id })
            .from(virtualAccountsTable)
            .where(
              and(
                eq(
                  virtualAccountsTable.accountNumber,
                  confirmation.vact.account,
                ),
                eq(virtualAccountsTable.memberId, issuance.memberId),
                eq(virtualAccountsTable.merchantId, context.merchant.id),
              ),
            )
            .limit(1);
          if (!ownedAccount)
            throw new Error("KPPay virtual account is already assigned");
        }
        await tx
          .update(virtualAccountIssuancesTable)
          .set({
            status: "issued",
            providerIssueId: confirmation.vact.issueId,
            verifiedAt: new Date(),
            updatedAt: new Date(),
            lastErrorCode: null,
          })
          .where(eq(virtualAccountIssuancesTable.id, issuance.id));
        await tx
          .update(membersTable)
          .set({ isVerified: true, isActive: true })
          .where(
            and(
              eq(membersTable.id, issuance.memberId),
              eq(membersTable.merchantId, context.merchant.id),
            ),
          );
      });
      const [completed] = await db
        .select()
        .from(virtualAccountIssuancesTable)
        .where(eq(virtualAccountIssuancesTable.id, issuance.id));
      res.json(
        registrationResponse(
          completed,
          await accountForMember(issuance.memberId),
        ),
      );
    } catch (error) {
      if (error instanceof KpPayError && error.status < 500) {
        const attempts = issuance.verificationAttempts + 1;
        await db
          .update(virtualAccountIssuancesTable)
          .set({
            verificationAttempts: attempts,
            lastErrorCode: error.resultCode ?? "INVALID_CODE",
            updatedAt: new Date(),
            ...(attempts >= 5 ? { status: "failed" } : {}),
          })
          .where(eq(virtualAccountIssuancesTable.id, issuance.id));
        res.status(400).json({
          error:
            attempts >= 5
              ? "인증번호 입력 횟수를 초과했습니다. 가입을 다시 시작해 주세요."
              : "1원 입금자명의 숫자 4자리가 일치하지 않습니다.",
          code: attempts >= 5 ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE",
          attemptsRemaining: Math.max(0, 5 - attempts),
        });
        return;
      }
      providerFailure(res, error, "virtual_account_confirmation");
    }
  },
);

router.post(
  "/external/v1/member-registrations/:id/cancel",
  async (req, res) => {
    const context = await authenticated(req, res);
    if (!context) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "올바르지 않은 가입 인증 번호입니다." });
      return;
    }
    const [issuance] = await db
      .select()
      .from(virtualAccountIssuancesTable)
      .where(
        and(
          eq(virtualAccountIssuancesTable.id, id),
          eq(virtualAccountIssuancesTable.merchantId, context.merchant.id),
        ),
      )
      .limit(1);
    if (!issuance) {
      res.status(404).json({ error: "가입 인증 정보를 찾을 수 없습니다." });
      return;
    }
    if (issuance.status === "issued") {
      res.status(409).json({ error: "이미 완료된 가입은 취소할 수 없습니다." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(virtualAccountIssuancesTable)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(virtualAccountIssuancesTable.id, issuance.id));
      await tx
        .delete(membersTable)
        .where(
          and(
            eq(membersTable.id, issuance.memberId),
            eq(membersTable.merchantId, context.merchant.id),
            eq(membersTable.isActive, false),
          ),
        );
    });
    res.status(204).end();
  },
);

router.get("/external/v1/members/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "올바르지 않은 회원 번호입니다." });
    return;
  }
  const storeScope = memberStoreScope(storeCodesValue(req));
  const [member] = await db
    .select()
    .from(membersTable)
    .where(
      and(
        eq(membersTable.id, id),
        eq(membersTable.merchantId, context.merchant.id),
        ...(storeScope ? [storeScope] : []),
      ),
    )
    .limit(1);
  if (!member) {
    res.status(404).json({ error: "회원을 찾을 수 없습니다." });
    return;
  }
  const account = await accountForMember(member.id);
  res.json({
    id: member.id,
    loginId: member.loginId,
    name: member.name,
    phone: member.phone,
    birthdate: member.birthdate ?? null,
    isActive: member.isActive,
    isVerified: member.isVerified,
    virtualAccount: account
      ? {
          id: account.id,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          status: account.status,
        }
      : null,
    createdAt: member.createdAt.toISOString(),
  });
});

/** Legacy direct creation is disabled because it bypasses 1-won verification. */
router.post("/external/v1/members", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  res.status(410).json({
    error: "정식 1원 인증 가입 API를 사용해 주세요.",
    code: "MEMBER_REGISTRATION_REQUIRED",
  });
  return;
  /*
  if (!(await allowRequest("merchant-member-create", `${context.merchant.id}:${req.ip ?? "unknown"}`, { limit: 20, windowSeconds: 60 * 60 }))) {
    res.status(429).json({ error: "Too many member creation requests" }); return;
  }
  const body = req.body as Record<string, unknown>;
  const loginId = typeof body.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(loginId) || password.length < 8 || !name || !phone) {
    res.status(400).json({ error: "Invalid member information" }); return;
  }
  const [duplicate] = await db.select({ id: membersTable.id }).from(membersTable).where(eq(membersTable.loginId, loginId)).limit(1);
  if (duplicate) { res.status(409).json({ error: "Member login ID already exists" }); return; }
  const [ledgerStore] = await db.select({
    id: adminUsersTable.id,
    loginId: adminUsersTable.loginId,
  }).from(adminUsersTable).where(and(
    eq(adminUsersTable.merchantId, context.merchant.id),
    eq(adminUsersTable.role, "store"),
    eq(adminUsersTable.isActive, true),
  )).orderBy(adminUsersTable.id).limit(1);
  if (!ledgerStore) {
    res.status(409).json({ error: "Merchant ledger store is not configured" }); return;
  }
  const [member] = await db.insert(membersTable).values({
    loginId, passwordHash: await hashPassword(password), name, phone,
    email: email || null,
    merchantId: context.merchant.id,
    storeId: ledgerStore.id,
    storeCode: ledgerStore.loginId,
    isVerified: true,
    isActive: true,
  }).returning();
  res.status(201).json({ id: member.id, loginId: member.loginId, name: member.name, phone: member.phone, email: member.email ?? null, isActive: member.isActive, virtualAccount: null, createdAt: member.createdAt.toISOString() });
  */
});

router.patch("/external/v1/members/:id", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid member ID" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof membersTable.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim())
    updates.name = body.name.trim();
  if (typeof body.phone === "string" && body.phone.trim())
    updates.phone = body.phone.trim();
  if (typeof body.email === "string") updates.email = body.email.trim() || null;
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No allowed changes" });
    return;
  }
  const [member] = await db
    .update(membersTable)
    .set(updates)
    .where(
      and(
        eq(membersTable.id, id),
        eq(membersTable.merchantId, context.merchant.id),
      ),
    )
    .returning();
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.json({
    id: member.id,
    loginId: member.loginId,
    name: member.name,
    phone: member.phone,
    email: member.email ?? null,
    isActive: member.isActive,
    createdAt: member.createdAt.toISOString(),
  });
});

export default router;
