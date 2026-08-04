import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Durable merchant webhook outbox.
 *
 * Rows are inserted in the same database transaction that settles the payment,
 * so a provider notification can never update the ledger without also
 * scheduling the corresponding merchant notification.
 */
export const merchantWebhookDeliveriesTable = pgTable(
  "merchant_webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull(),
    merchantId: integer("merchant_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),
    lastAttemptAt: timestamp("last_attempt_at"),
    deliveredAt: timestamp("delivered_at"),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("merchant_webhook_deliveries_event_unique").on(table.eventId),
    index("merchant_webhook_deliveries_dispatch_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("merchant_webhook_deliveries_merchant_created_idx").on(
      table.merchantId,
      table.createdAt,
    ),
    check(
      "merchant_webhook_deliveries_status_check",
      sql`${table.status} in ('pending', 'processing', 'retry', 'delivered', 'dead')`,
    ),
    check(
      "merchant_webhook_deliveries_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);
