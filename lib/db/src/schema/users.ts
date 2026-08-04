import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminUsersTable = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  loginId: text("login_id").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(), // superadmin | hq | distributor | agency | store
  permission: text("permission").notNull().default("admin"), // readonly | admin | finance
  isActive: boolean("is_active").notNull().default(true),
  useOtp: boolean("use_otp").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(0),
  merchantId: integer("merchant_id"), // null only for TodoPay platform operators
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAdminUserSchema = createInsertSchema(adminUsersTable).omit({ id: true, createdAt: true });
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsersTable.$inferSelect;
