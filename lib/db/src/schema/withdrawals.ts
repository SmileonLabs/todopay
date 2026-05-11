import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  trackingNumber: text("tracking_number").notNull().unique(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  approvalStatus: text("approval_status").notNull().default("pending"), // pending | approved | rejected
  withdrawalStatus: text("withdrawal_status").notNull().default("unpaid"), // unpaid | paid
  accountNumber: text("account_number").notNull(),
  accountBank: text("account_bank").notNull(),
  accountHolder: text("account_holder").notNull(),
  rejectReason: text("reject_reason"),
  memberId: integer("member_id"),
  storeId: integer("store_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({ id: true, createdAt: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
