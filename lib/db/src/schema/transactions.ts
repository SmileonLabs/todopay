import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // deposit | withdrawal
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("success"), // success | failed | pending
  fromAccount: text("from_account").notNull(),
  toAccount: text("to_account").notNull(),
  trackingNumber: text("tracking_number").notNull().unique(),
  pgTransactionId: text("pg_transaction_id").notNull(),
  memberId: integer("member_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
