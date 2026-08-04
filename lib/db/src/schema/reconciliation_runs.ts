import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Immutable snapshots produced by the automatic financial integrity checker. */
export const reconciliationRunsTable = pgTable("reconciliation_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(), // healthy | warning | failed
  balanceMismatchCount: integer("balance_mismatch_count").notNull().default(0),
  ledgerMismatchCount: integer("ledger_mismatch_count").notNull().default(0),
  staleEventCount: integer("stale_event_count").notNull().default(0),
  stalePayoutCount: integer("stale_payout_count").notNull().default(0),
  deadEventCount: integer("dead_event_count").notNull().default(0),
  providerBalance: text("provider_balance"),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("reconciliation_runs_created_at_idx").on(table.createdAt),
  index("reconciliation_runs_status_created_at_idx").on(table.status, table.createdAt),
]);
