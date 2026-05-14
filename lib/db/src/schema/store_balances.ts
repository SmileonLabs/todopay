import { pgTable, serial, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storeBalancesTable = pgTable("store_balances", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().unique(),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStoreBalanceSchema = createInsertSchema(storeBalancesTable).omit({ id: true, updatedAt: true });
export type InsertStoreBalance = z.infer<typeof insertStoreBalanceSchema>;
export type StoreBalance = typeof storeBalancesTable.$inferSelect;
