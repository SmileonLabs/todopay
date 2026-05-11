import { pgTable, serial, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feeConfigsTable = pgTable("fee_configs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  depositFee: numeric("deposit_fee", { precision: 5, scale: 2 }).notNull().default("0"),
  withdrawalFee: numeric("withdrawal_fee", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFeeConfigSchema = createInsertSchema(feeConfigsTable).omit({ id: true, createdAt: true });
export type InsertFeeConfig = z.infer<typeof insertFeeConfigSchema>;
export type FeeConfig = typeof feeConfigsTable.$inferSelect;
