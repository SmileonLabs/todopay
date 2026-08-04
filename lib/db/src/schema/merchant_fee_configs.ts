import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * TodoPay's commercial fee policy for a merchant.
 * Legacy organization/store commissions remain in fee_configs.
 */
export const merchantFeeConfigsTable = pgTable(
  "merchant_fee_configs",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    depositFee: integer("deposit_fee").notNull().default(0),
    withdrawalFee: integer("withdrawal_fee").notNull().default(0),
    usageFeeRate: numeric("usage_fee_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("merchant_fee_configs_merchant_unique").on(table.merchantId),
    index("merchant_fee_configs_effective_from_idx").on(table.effectiveFrom),
    check(
      "merchant_fee_configs_deposit_fee_check",
      sql`${table.depositFee} >= 0`,
    ),
    check(
      "merchant_fee_configs_withdrawal_fee_check",
      sql`${table.withdrawalFee} >= 0`,
    ),
    check(
      "merchant_fee_configs_usage_fee_rate_check",
      sql`${table.usageFeeRate} >= 0 and ${table.usageFeeRate} <= 100`,
    ),
  ],
);

export type MerchantFeeConfig = typeof merchantFeeConfigsTable.$inferSelect;
