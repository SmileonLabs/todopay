import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

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
  await db.insert(auditLogsTable).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId == null ? null : String(entry.resourceId),
    requestId: req.get("X-Request-Id") ?? null,
    ipAddress: (req.ip ?? "").replace(/^::ffff:/, "") || null,
    metadata: entry.metadata ?? {},
  });
}
