import { sql } from "drizzle-orm";
import { check, index, pgTable, serial, text, numeric, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // deposit | withdrawal
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("received"), // received | processing | success | failed | pending (legacy)
  fromAccount: text("from_account").notNull(),
  toAccount: text("to_account").notNull(),
  trackingNumber: text("tracking_number").notNull().unique(),
  pgTransactionId: text("pg_transaction_id").notNull(),
  providerEventId: text("provider_event_id"),
  idempotencyKey: text("idempotency_key"),
  memberId: integer("member_id"),
  merchantId: integer("merchant_id"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("transactions_pg_transaction_id_unique").on(table.pgTransactionId),
  uniqueIndex("transactions_provider_event_id_unique").on(table.providerEventId),
  uniqueIndex("transactions_idempotency_key_unique").on(table.idempotencyKey),
  index("transactions_member_created_at_idx").on(table.memberId, table.createdAt),
  index("transactions_merchant_created_at_idx").on(table.merchantId, table.createdAt),
  index("transactions_status_created_at_idx").on(table.status, table.createdAt),
  check("transactions_status_check", sql`${table.status} in ('received', 'processing', 'pending', 'success', 'failed')`),
]);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
