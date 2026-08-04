import crypto from "crypto";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, merchantsTable } from "@workspace/db";

export type MerchantApiContext = {
  merchant: typeof merchantsTable.$inferSelect;
};

function requestIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

function isAllowedIp(ip: string, allowedIps: string[] | null): boolean {
  if (!allowedIps || allowedIps.length === 0) return false;
  return allowedIps.some((entry) => entry.trim() === ip || entry.trim() === `${ip}/32`);
}

/** Authenticate a server-to-server TodoPay merchant API request without exposing DB access. */
export async function requireMerchantApi(req: Request): Promise<MerchantApiContext | null> {
  const rawKey = req.get("X-TodoPay-Api-Key")?.trim();
  if (!rawKey || !/^tp_live_[A-Za-z0-9_-]{32,}$/.test(rawKey)) return null;

  const apiKeyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const [merchant] = await db.select().from(merchantsTable)
    .where(eq(merchantsTable.apiKeyHash, apiKeyHash)).limit(1);
  if (!merchant || merchant.status !== "active" || !merchant.apiKeyHash || !isAllowedIp(requestIp(req), merchant.allowedIps)) return null;
  return { merchant };
}
