import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Immutable fee configuration captured when a settlement is allocated.
 * Later configuration changes must never alter an already-booked transaction.
 */
export const feePolicyVersionsTable = pgTable("fee_policy_versions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(),
  version: integer("version").notNull(),
  totalRate: numeric("total_rate", { precision: 5, scale: 2 }).notNull(),
  depositFee: integer("deposit_fee").notNull().default(0),
  withdrawalFee: integer("withdrawal_fee").notNull().default(0),
  configurationHash: text("configuration_hash").notNull(),
  allocationSnapshot: jsonb("allocation_snapshot").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("fee_policy_versions_store_version_unique").on(
    table.storeId,
    table.version,
  ),
  uniqueIndex("fee_policy_versions_store_hash_unique").on(
    table.storeId,
    table.configurationHash,
  ),
  index("fee_policy_versions_store_created_idx").on(
    table.storeId,
    table.createdAt,
  ),
  check(
    "fee_policy_versions_total_rate_check",
    sql`${table.totalRate} >= 0 AND ${table.totalRate} <= 100`,
  ),
  check("fee_policy_versions_deposit_fee_check", sql`${table.depositFee} >= 0`),
  check(
    "fee_policy_versions_withdrawal_fee_check",
    sql`${table.withdrawalFee} >= 0`,
  ),
]);

/**
 * One immutable Sellink settlement allocation per TodoPay event.
 * This is a derived subledger; TodoPay remains the payment-system ledger.
 */
export const internalFeeSettlementsTable = pgTable("internal_fee_settlements", {
  id: serial("id").primaryKey(),
  sourceEventId: text("source_event_id").notNull(),
  sourceEventType: text("source_event_type").notNull(),
  externalTransactionId: text("external_transaction_id").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  storeId: integer("store_id").notNull(),
  policyVersionId: integer("policy_version_id").notNull(),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 0 }).notNull(),
  todoPayFee: numeric("todopay_fee", { precision: 18, scale: 0 }).notNull(),
  settlementAmount: numeric("settlement_amount", { precision: 18, scale: 0 }).notNull(),
  internalFeeAmount: numeric("internal_fee_amount", { precision: 18, scale: 0 }).notNull(),
  storeCommissionAmount: numeric("store_commission_amount", { precision: 18, scale: 0 }).notNull(),
  status: text("status").notNull().default("applied"),
  reversedByEventId: text("reversed_by_event_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  reversedAt: timestamp("reversed_at"),
}, (table) => [
  uniqueIndex("internal_fee_settlements_source_event_unique").on(table.sourceEventId),
  uniqueIndex("internal_fee_settlements_reversal_event_unique").on(table.reversedByEventId),
  index("internal_fee_settlements_store_created_idx").on(table.storeId, table.createdAt),
  index("internal_fee_settlements_external_tx_idx").on(table.externalTransactionId),
  index("internal_fee_settlements_tracking_idx").on(table.trackingNumber),
  check(
    "internal_fee_settlements_amounts_check",
    sql`
      ${table.grossAmount} >= 0
      AND ${table.todoPayFee} >= 0
      AND ${table.settlementAmount} >= 0
      AND ${table.internalFeeAmount} >= 0
      AND ${table.storeCommissionAmount} >= 0
    `,
  ),
  check(
    "internal_fee_settlements_status_check",
    sql`${table.status} IN ('applied', 'reversed')`,
  ),
]);

/**
 * Append-only double-entry-like allocation journal.
 * Positive amounts apply a settlement; negative amounts reverse the exact
 * original entry. Reversals never recalculate using the current fee policy.
 */
export const internalFeeLedgerEntriesTable = pgTable("internal_fee_ledger_entries", {
  id: serial("id").primaryKey(),
  settlementId: integer("settlement_id").notNull(),
  sourceEventId: text("source_event_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  beneficiaryUserId: integer("beneficiary_user_id").notNull(),
  storeId: integer("store_id").notNull(),
  entryType: text("entry_type").notNull(),
  component: text("component").notNull(),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 0 }).notNull(),
  commissionAmount: numeric("commission_amount", { precision: 18, scale: 0 }).notNull(),
  referenceEntryId: integer("reference_entry_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("internal_fee_ledger_idempotency_unique").on(table.idempotencyKey),
  index("internal_fee_ledger_settlement_idx").on(table.settlementId, table.id),
  index("internal_fee_ledger_beneficiary_created_idx").on(
    table.beneficiaryUserId,
    table.createdAt,
  ),
  check(
    "internal_fee_ledger_entry_type_check",
    sql`${table.entryType} IN ('allocation', 'reversal')`,
  ),
  check(
    "internal_fee_ledger_component_check",
    sql`${table.component} IN ('store_settlement', 'organization_commission')`,
  ),
  check(
    "internal_fee_ledger_rate_check",
    sql`${table.rate} >= 0 AND ${table.rate} <= 100`,
  ),
  check(
    "internal_fee_ledger_commission_check",
    sql`
      (
        ${table.entryType} = 'allocation'
        AND ${table.amount} >= 0
        AND ${table.commissionAmount} >= 0
      )
      OR (
        ${table.entryType} = 'reversal'
        AND ${table.amount} <= 0
        AND ${table.commissionAmount} <= 0
      )
    `,
  ),
]);

/**
 * Transactionally maintained read model. The journal above is authoritative
 * and can be used to reconcile or rebuild these cached balances.
 */
export const internalFeeBalancesTable = pgTable("internal_fee_balances", {
  userId: integer("user_id").notNull(),
  storeId: integer("store_id").notNull(),
  availableAmount: numeric("available_amount", { precision: 18, scale: 0 })
    .notNull()
    .default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: "internal_fee_balances_user_store_pk",
    columns: [table.userId, table.storeId],
  }),
  index("internal_fee_balances_store_idx").on(table.storeId, table.userId),
]);
