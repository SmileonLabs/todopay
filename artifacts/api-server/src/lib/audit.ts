import type { Request } from "express";
import { auditLogsTable, db } from "@workspace/db";
import { logger } from "./logger.js";

type AuditEntry = {
  actorId?: number | null;
  actorType?: "admin" | "member" | "system";
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  metadata?: Record<string, unknown>;
};

/** Audit logging must never invalidate a successfully completed money movement. */
export async function writeAuditLog(req: Request | undefined, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorId: entry.actorId ?? null,
      actorType: entry.actorType ?? "admin",
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId == null ? null : String(entry.resourceId),
      metadata: entry.metadata ?? {},
      ipAddress: req?.ip ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action, resourceType: entry.resourceType }, "Audit log write failed");
  }
}
