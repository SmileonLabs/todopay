import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Maps Sellink-owned identities to TodoPay identities without copying the
 * authoritative financial records into the Sellink database.
 */
export const integrationMappingsTable = pgTable("integration_mappings", {
  id: serial("id").primaryKey(),
  localEntityType: text("local_entity_type").notNull(),
  localEntityId: integer("local_entity_id").notNull(),
  todoPayEntityType: text("todopay_entity_type").notNull(),
  todoPayEntityId: text("todopay_entity_id").notNull(),
  syncStatus: text("sync_status").notNull().default("active"),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("integration_mappings_local_unique").on(table.localEntityType, table.localEntityId),
  uniqueIndex("integration_mappings_todopay_unique").on(table.todoPayEntityType, table.todoPayEntityId),
  index("integration_mappings_status_idx").on(table.syncStatus, table.updatedAt),
]);
