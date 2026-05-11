import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const balanceRecordsTable = pgTable("balance_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  direction: text("direction").notNull(), // in | out
  category: text("category").notNull(), // withdrawal | payment
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBalanceRecordSchema = createInsertSchema(balanceRecordsTable).omit({ id: true, createdAt: true });
export type InsertBalanceRecord = z.infer<typeof insertBalanceRecordSchema>;
export type BalanceRecord = typeof balanceRecordsTable.$inferSelect;
