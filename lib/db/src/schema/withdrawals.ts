import { sql } from "drizzle-orm";
import { check, index, pgTable, serial, text, numeric, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  trackingNumber: text("tracking_number").notNull().unique(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  approvalStatus: text("approval_status").notNull().default("pending"), // pending | approved | rejected
  withdrawalStatus: text("withdrawal_status").notNull().default("unpaid"), // unpaid | submitting | processing | paid | failed | unknown
  providerTransactionId: text("provider_transaction_id"),
  providerResultCode: text("provider_result_code"),
  providerResultMessage: text("provider_result_message"),
  providerUpdatedAt: timestamp("provider_updated_at"),
  submissionAttemptCount: integer("submission_attempt_count").notNull().default(0),
  submissionClaimedAt: timestamp("submission_claimed_at"),
  submissionClaimedBy: text("submission_claimed_by"),
  nextSubmissionAt: timestamp("next_submission_at").notNull().defaultNow(),
  submissionLastError: text("submission_last_error"),
  accountNumber: text("account_number").notNull(),
  accountBank: text("account_bank").notNull(),
  accountHolder: text("account_holder").notNull(),
  rejectReason: text("reject_reason"),
  memberId: integer("member_id"),
  storeId: integer("store_id"),
  merchantId: integer("merchant_id"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  paidBy: integer("paid_by"),
  paidAt: timestamp("paid_at"),
  availableAt: timestamp("available_at"), // 익일 오전 10시 KST (출금 승인 가능 시각)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("withdrawals_store_created_at_idx").on(table.storeId, table.createdAt),
  index("withdrawals_merchant_created_at_idx").on(table.merchantId, table.createdAt),
  index("withdrawals_approval_created_at_idx").on(table.approvalStatus, table.createdAt),
  uniqueIndex("withdrawals_provider_transaction_id_unique").on(table.providerTransactionId),
  check("withdrawals_approval_status_check", sql`${table.approvalStatus} in ('pending', 'approved', 'rejected')`),
  index("withdrawals_submission_work_idx").on(table.approvalStatus, table.withdrawalStatus, table.nextSubmissionAt),
  check("withdrawals_payment_status_check", sql`${table.withdrawalStatus} in ('unpaid', 'submitting', 'processing', 'paid', 'failed', 'unknown')`),
]);

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({ id: true, createdAt: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
