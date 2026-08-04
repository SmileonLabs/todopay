import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * A merchant is a TodoPay customer. Korea Payment System only sees TodoPay as
 * the master merchant; this table is the authoritative internal tenancy boundary.
 */
export const merchantsTable = pgTable("merchants", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"), // pending | active | suspended | terminated
  // Deprecated: all new merchants use the shared partner.todopay.io portal.
  // Kept temporarily so existing merchant records remain backwards compatible.
  adminDomain: text("admin_domain"),
  apiKeyPrefix: text("api_key_prefix"),
  apiKeyHash: text("api_key_hash"),
  webhookUrl: text("webhook_url"),
  webhookSecretVersion: integer("webhook_secret_version").notNull().default(1),
  allowedIps: text("allowed_ips").array(),
  dailyWithdrawalLimit: integer("daily_withdrawal_limit").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("merchants_code_unique").on(table.code),
  uniqueIndex("merchants_admin_domain_unique").on(table.adminDomain),
  index("merchants_status_created_at_idx").on(table.status, table.createdAt),
  check("merchants_code_format_check", sql`${table.code} ~ '^[A-Z][A-Z0-9_]{2,63}$'`),
  check("merchants_status_check", sql`${table.status} in ('pending', 'active', 'suspended', 'terminated')`),
  check("merchants_webhook_secret_version_check", sql`${table.webhookSecretVersion} > 0`),
  check("merchants_daily_withdrawal_limit_check", sql`${table.dailyWithdrawalLimit} >= 0`),
]);
