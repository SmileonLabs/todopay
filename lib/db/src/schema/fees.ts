import { pgTable, serial, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feeConfigsTable = pgTable("fee_configs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  depositFee: integer("deposit_fee").notNull().default(0),        // 입금 건당 수수료 (정액, 원/건)
  withdrawalFee: integer("withdrawal_fee").notNull().default(0),  // 출금 건당 수수료 (정액, 원/건)
  usageFeeRate: numeric("usage_fee_rate", { precision: 5, scale: 2 }).notNull().default("0"), // 이용 수수료율 (%)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFeeConfigSchema = createInsertSchema(feeConfigsTable).omit({ id: true, createdAt: true });
export type InsertFeeConfig = z.infer<typeof insertFeeConfigSchema>;
export type FeeConfig = typeof feeConfigsTable.$inferSelect;
