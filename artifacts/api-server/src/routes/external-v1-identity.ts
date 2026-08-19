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

router.get("/external/v1/merchant", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchant = context.merchant;
  res.json({
    id: merchant.id,
    code: merchant.code,
    name: merchant.name,
    status: merchant.status,
    webhookUrl: merchant.webhookUrl,
    allowedIps: merchant.allowedIps ?? [],
    dailyWithdrawalLimit: merchant.dailyWithdrawalLimit,
  });
});

router.get("/external/v1/integration", async (req, res) => {
  const context = await authenticated(req, res);
  if (!context) return;
  const merchant = context.merchant;
  res.json({
    merchantCode: merchant.code,
    merchantStatus: merchant.status,
    apiAuthenticated: true,
    allowedIpCount: merchant.allowedIps?.length ?? 0,
    webhookConfigured: Boolean(merchant.webhookUrl),
    paymentProviderEnabled: process.env.PAYMENT_PROVIDER_ENABLED === "true",
    checkedAt: new Date().toISOString(),
  });
});

export default router;
