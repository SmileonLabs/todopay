import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const virtualAccountsTable = pgTable("virtual_accounts", {
  id: serial("id").primaryKey(),
  accountNumber: text("account_number").notNull().unique(),
  bankName: text("bank_name").notNull(),
  status: text("status").notNull().default("active"), // active | revoked
  memberId: integer("member_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVirtualAccountSchema = createInsertSchema(virtualAccountsTable).omit({ id: true, createdAt: true });
export type InsertVirtualAccount = z.infer<typeof insertVirtualAccountSchema>;
export type VirtualAccount = typeof virtualAccountsTable.$inferSelect;
