import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger.js";

export async function writeAuditLog(
  req: Request,
  entry: {
    actorId?: number | null;
    action: string;
    resourceType: string;
    resourceId?: string | number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId == null ? null : String(entry.resourceId),
      requestId: req.get("X-Request-Id") ?? null,
      ipAddress: (req.ip ?? "").replace(/^::ffff:/, "") || null,
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    // An audit storage outage must not make a completed financial operation
    // look failed to the caller and trigger a duplicate retry.
    logger.error({
      err: error,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
    }, "Audit log write failed");
  }
}
