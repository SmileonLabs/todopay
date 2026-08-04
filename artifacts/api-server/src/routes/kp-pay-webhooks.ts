import { Router, type Request, type Response } from "express";
import { db, paymentEventsTable } from "@workspace/db";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";

const router = Router();
const allowedSources = new Set(
  (process.env.KP_PAY_WEBHOOK_IPS ?? "112.175.152.181")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const virtualAccountNotification = z.object({
  vactId: z.string().min(1).max(30),
  retry: z.coerce.number().int().nonnegative().optional(),
  mchtId: z.string().min(1).max(50),
  issueId: z.string().min(1).max(30),
  amount: z.coerce.number().int().positive(),
  trxType: z.enum(["deposit", "depositback"]),
  rootVactId: z.string().max(30).optional().nullable(),
  trackId: z.string().min(1).max(50),
}).passthrough();

const payoutNotification = z.object({
  trxId: z.string().min(1).max(30),
  mchtId: z.string().min(1).max(50),
  trackId: z.string().min(1).max(50),
  status: z.enum(["출금완료", "출금실패", "출금확인불가"]),
  resultCd: z.string().max(10).optional(),
  resultMsg: z.string().max(200).optional(),
  amount: z.coerce.number().int().positive().optional(),
}).passthrough();

function sourceIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

function requireAllowedSource(req: Request, res: Response): boolean {
  if (allowedSources.has(sourceIp(req))) return true;
  logger.warn({ ip: sourceIp(req) }, "Rejected KPPay webhook from unapproved source");
  res.status(403).type("text/plain").send("Forbidden");
  return false;
}

async function persistEvent(input: {
  eventId: string;
  eventType: string;
  trackingNumber: string;
  payload: unknown;
}): Promise<void> {
  await db.insert(paymentEventsTable).values({
    provider: "kp_pay",
    eventId: input.eventId,
    eventType: input.eventType,
    trackingNumber: input.trackingNumber,
    payload: input.payload,
    status: "received",
    nextAttemptAt: new Date(),
  }).onConflictDoNothing();
}

/** Persist first, then acknowledge. A worker performs all financial mutations. */
router.post("/webhooks/kp-pay/virtual-account", async (req, res) => {
  if (!requireAllowedSource(req, res)) return;
  const raw = req.body?.response;
  if (typeof raw !== "string") {
    res.status(400).type("text/plain").send("Invalid notification");
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).type("text/plain").send("Invalid notification");
    return;
  }
  const parsed = virtualAccountNotification.safeParse(payload);
  if (!parsed.success) {
    res.status(400).type("text/plain").send("Invalid notification");
    return;
  }
  try {
    await persistEvent({
      eventId: parsed.data.vactId,
      eventType: parsed.data.trxType,
      trackingNumber: parsed.data.trackId,
      payload: parsed.data,
    });
    res.status(200).type("text/plain").send("OK");
  } catch (error) {
    logger.error({ err: error, trackId: parsed.data.trackId }, "KPPay event could not be persisted");
    res.status(500).type("text/plain").send("Retry");
  }
});

router.post("/webhooks/kp-pay/payout", async (req, res) => {
  if (!requireAllowedSource(req, res)) return;
  const parsed = payoutNotification.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).type("text/plain").send("Invalid notification");
    return;
  }
  const nextStatus = parsed.data.status === "출금완료"
    ? "paid"
    : parsed.data.status === "출금실패" ? "failed" : "unknown";
  try {
    await persistEvent({
      eventId: parsed.data.trxId,
      eventType: `payout:${nextStatus}`,
      trackingNumber: parsed.data.trackId,
      payload: parsed.data,
    });
    res.status(200).type("text/plain").send("OK");
  } catch (error) {
    logger.error({ err: error, trackId: parsed.data.trackId }, "KPPay payout event could not be persisted");
    res.status(500).type("text/plain").send("Retry");
  }
});

export default router;
