import { index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * TodoPay events received by Sellink.
 *
 * This is an idempotency and audit inbox only. Financial balances and ledgers
 * remain authoritative in TodoPay and are never duplicated in this table.
 */
export const todoPayWebhookEventsTable = pgTable("todopay_webhook_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  signatureVersion: text("signature_version").notNull().default("v1"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("todopay_webhook_events_event_unique").on(table.eventId),
  index("todopay_webhook_events_type_received_idx").on(
    table.eventType,
    table.receivedAt,
  ),
]);
