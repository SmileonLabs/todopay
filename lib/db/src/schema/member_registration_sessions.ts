import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A short-lived orchestration record. Raw passwords, verification codes and
 * bank account numbers are deliberately never stored in this table.
 */
export const memberRegistrationSessionsTable = pgTable("member_registration_sessions", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull(),
  localMemberId: integer("local_member_id").notNull(),
  todoPayMemberId: text("todopay_member_id"),
  todoPayRegistrationId: text("todopay_registration_id"),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("starting"),
  verificationAttempts: integer("verification_attempts").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("member_registration_sessions_public_unique").on(table.publicId),
  uniqueIndex("member_registration_sessions_local_member_unique").on(table.localMemberId),
  index("member_registration_sessions_status_expiry_idx").on(table.status, table.expiresAt),
]);
