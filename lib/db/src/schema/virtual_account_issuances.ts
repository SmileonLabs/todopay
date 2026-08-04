import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Durable state for the KPPay 1-won verification flow. A virtual account is
 * written to `virtual_accounts` only after KPPay confirms registration.
 */
export const virtualAccountIssuancesTable = pgTable("virtual_account_issuances", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id"),
  memberId: integer("member_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  trackingNumber: text("tracking_number").notNull(),
  virtualAccountNumber: text("virtual_account_number").notNull(),
  virtualBankCode: text("virtual_bank_code").notNull(),
  status: text("status").notNull().default("requesting"), // requesting | awaiting_verification | issued | failed | cancelled | expired
  providerAuthNo: text("provider_auth_no"),
  providerIssueId: text("provider_issue_id"),
  verificationAttempts: integer("verification_attempts").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  expiresAt: timestamp("expires_at"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("virtual_account_issuances_tracking_unique").on(table.trackingNumber),
  uniqueIndex("virtual_account_issuances_provider_issue_unique").on(table.providerIssueId),
  uniqueIndex("virtual_account_issuances_merchant_idempotency_unique").on(table.merchantId, table.idempotencyKey),
  index("virtual_account_issuances_member_created_idx").on(table.memberId, table.createdAt),
  index("virtual_account_issuances_status_created_idx").on(table.status, table.createdAt),
]);
