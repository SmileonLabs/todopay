import { check, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Immutable, idempotent store-balance movements. Amounts are always KRW integers. */
export const moneyLedgerTable = pgTable("money_ledger", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(),
  merchantId: integer("merchant_id"),
  direction: text("direction").notNull(), // credit | debit
  amount: numeric("amount", { precision: 18, scale: 0 }).notNull(),
  entryType: text("entry_type").notNull(), // deposit_credit | withdrawal_reserve | withdrawal_refund
  referenceType: text("reference_type").notNull(),
  referenceId: integer("reference_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("money_ledger_reference_entry_unique").on(table.referenceType, table.referenceId, table.entryType),
  index("money_ledger_store_created_at_idx").on(table.storeId, table.createdAt),
  index("money_ledger_merchant_created_at_idx").on(table.merchantId, table.createdAt),
  check("money_ledger_direction_check", sql`${table.direction} in ('credit', 'debit')`),
  check("money_ledger_amount_positive_check", sql`${table.amount} > 0`),
]);
