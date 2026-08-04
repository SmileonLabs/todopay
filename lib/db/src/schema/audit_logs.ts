import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Immutable audit trail for privileged and money-moving actions. */
export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id"),
  actorType: text("actor_type").notNull().default("admin"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  metadata: jsonb("metadata").notNull().default({}),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("audit_logs_resource_created_at_idx").on(table.resourceType, table.resourceId, table.createdAt),
  index("audit_logs_actor_created_at_idx").on(table.actorId, table.createdAt),
]);
