import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Merchant-scoped order payment request. Provider matching is intentionally nullable. */
export const paymentIntentsTable = pgTable("payment_intents", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull(),
  merchantId: integer("merchant_id").notNull(),
  merchantOrderId: text("merchant_order_id").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  externalCustomerId: text("external_customer_id"),
  memberId: integer("member_id"),
  virtualAccountId: integer("virtual_account_id"),
  transactionId: integer("transaction_id"),
  amount: numeric("amount", { precision: 18, scale: 0 }).notNull(),
  currency: text("currency").notNull().default("KRW"),
  status: text("status").notNull().default("requires_member"),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  providerTrackingNumber: text("provider_tracking_number"),
  description: text("description"),
  metadata: jsonb("metadata").notNull().default({}),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at").notNull(),
  succeededAt: timestamp("succeeded_at"),
  cancelledAt: timestamp("cancelled_at"),
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payment_intents_public_id_unique").on(table.publicId),
  uniqueIndex("payment_intents_merchant_order_attempt_unique").on(table.merchantId, table.merchantOrderId, table.attemptNumber),
  uniqueIndex("payment_intents_merchant_idempotency_unique").on(table.merchantId, table.idempotencyKey),
  uniqueIndex("payment_intents_transaction_unique").on(table.transactionId),
  uniqueIndex("payment_intents_provider_tracking_unique").on(table.providerTrackingNumber),
  index("payment_intents_merchant_customer_created_idx").on(table.merchantId, table.externalCustomerId, table.createdAt),
  index("payment_intents_status_expires_idx").on(table.status, table.expiresAt),
  check("payment_intents_amount_positive_check", sql`${table.amount} > 0`),
  check("payment_intents_currency_check", sql`${table.currency} = 'KRW'`),
  check("payment_intents_version_check", sql`${table.version} > 0`),
  check("payment_intents_attempt_number_check", sql`${table.attemptNumber} > 0`),
  check("payment_intents_provider_tracking_number_length_check", sql`${table.providerTrackingNumber} is null or char_length(${table.providerTrackingNumber}) <= 50`),
  check("payment_intents_status_check", sql`${table.status} in ('requires_member', 'awaiting_deposit', 'processing', 'succeeded', 'amount_mismatch', 'expired', 'cancelled', 'reversed')`),
]);

/** Immutable domain history, distinct from the provider notification inbox. */
export const paymentIntentEventsTable = pgTable("payment_intent_events", {
  id: serial("id").primaryKey(),
  paymentIntentId: integer("payment_intent_id").notNull(),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  sourceEventId: text("source_event_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payment_intent_events_source_unique").on(table.source, table.sourceEventId),
  index("payment_intent_events_intent_created_idx").on(table.paymentIntentId, table.createdAt),
]);
