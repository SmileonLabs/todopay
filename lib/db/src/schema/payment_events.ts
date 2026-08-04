import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Durable provider webhook inbox. Financial work is performed after this row commits. */
export const paymentEventsTable = pgTable("payment_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  merchantId: integer("merchant_id"),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"), // received | processing | retry | processed | duplicate | dead
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  lockedAt: timestamp("locked_at"),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
}, (table) => [
  uniqueIndex("payment_events_provider_event_unique").on(table.provider, table.eventId, table.eventType),
  index("payment_events_tracking_idx").on(table.trackingNumber),
  index("payment_events_work_idx").on(table.status, table.nextAttemptAt),
  index("payment_events_merchant_processed_at_idx").on(table.merchantId, table.processedAt),
]);
