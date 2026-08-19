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

export function paymentIntentResponse(
  intent: typeof paymentIntentsTable.$inferSelect,
  account: typeof virtualAccountsTable.$inferSelect | null,
) {
  return {
    id: intent.publicId,
    merchantOrderId: intent.merchantOrderId,
    attemptNumber: intent.attemptNumber,
    externalCustomerId: intent.externalCustomerId,
    memberId: intent.memberId,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
    trackingNumber: intent.providerTrackingNumber,
    expiresAt: intent.expiresAt.toISOString(),
    virtualAccount: account
      ? {
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          status: account.status,
        }
      : null,
    description: intent.description,
    metadata: intent.metadata,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

export async function intentAccount(
  intent: typeof paymentIntentsTable.$inferSelect,
) {
  if (!intent.virtualAccountId) return null;
  const [account] = await db
    .select()
    .from(virtualAccountsTable)
    .where(
      and(
        eq(virtualAccountsTable.id, intent.virtualAccountId),
        eq(virtualAccountsTable.merchantId, intent.merchantId),
      ),
    )
    .limit(1);
  return account ?? null;
}

export function providerFailure(
  res: Response,
  error: unknown,
  operation: "virtual_account_registration" | "virtual_account_confirmation",
): void {
  if (error instanceof KpPayError) {
    logger.warn(
      {
        operation,
        provider: "kp-pay",
        httpStatus: error.status,
        resultCode: error.resultCode ?? null,
        outcomeUnknown: error.outcomeUnknown,
        providerMessage: error.message
          .replace(/\d{6,}/g, "[redacted]")
          .slice(0, 200),
      },
      "KPPay virtual-account request rejected",
    );
    const status =
      error.status >= 400 && error.status <= 599 ? error.status : 400;
    res.status(status).json({
      error:
        error.status >= 500
          ? "본인계좌 인증기관 연결에 실패했습니다."
          : "본인계좌 정보를 확인할 수 없습니다.",
      code: error.resultCode ?? "KP_PAY_ERROR",
    });
    return;
  }
  res
    .status(502)
    .json({
      error: "본인계좌 인증기관 연결에 실패했습니다.",
      code: "KP_PAY_ERROR",
    });
}

export async function accountForMember(memberId: number) {
  const [account] = await db
    .select()
    .from(virtualAccountsTable)
    .where(
      and(
        eq(virtualAccountsTable.memberId, memberId),
        eq(virtualAccountsTable.status, "active"),
      ),
    )
    .orderBy(desc(virtualAccountsTable.createdAt))
    .limit(1);
  return account ?? null;
}

export function registrationResponse(
  issuance: typeof virtualAccountIssuancesTable.$inferSelect,
  account: typeof virtualAccountsTable.$inferSelect | null = null,
) {
  return {
    registrationId: issuance.id,
    memberId: issuance.memberId,
    status: issuance.status,
    expiresAt: issuance.expiresAt?.toISOString() ?? null,
    attemptsRemaining: Math.max(0, 5 - issuance.verificationAttempts),
    virtualAccount: account
      ? {
          id: account.id,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          status: account.status,
        }
      : null,
  };
}

export async function authenticated(req: Request, res: Response) {
  const context = await requireMerchantApi(req);
  if (!context) {
    res.status(401).json({ error: "Invalid merchant API credentials" });
    return null;
  }
  if (
    !(await allowRequest(
      "merchant-api",
      `${req.ip ?? "unknown"}:${context.merchant.id}`,
      { limit: 600, windowSeconds: 60 },
    ))
  ) {
    res.status(429).json({ error: "Merchant API rate limit exceeded" });
    return null;
  }
  return context;
}
