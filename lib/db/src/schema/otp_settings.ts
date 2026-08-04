import { pgTable, serial, boolean, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const otpSettingsTable = pgTable("otp_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  useOtpForDeposit: boolean("use_otp_for_deposit").notNull().default(false),
  useOtpForWithdrawal: boolean("use_otp_for_withdrawal").notNull().default(false),
  otpSecret: text("otp_secret"),
  pendingSecret: text("pending_secret"),
  verifiedAt: timestamp("verified_at"),
  recoveryCodesHash: text("recovery_codes_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOtpSettingSchema = createInsertSchema(otpSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOtpSetting = z.infer<typeof insertOtpSettingSchema>;
export type OtpSetting = typeof otpSettingsTable.$inferSelect;
