import type { Request, Response } from "express";
import { db, todoPayWebhookEventsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { verifyTodoPayWebhook } from "../lib/todopay-webhook-signing.js";

const supportedEventTypes = new Set([
  "webhook.test",
  "deposit.completed",
  "deposit.reversed",
  "payout.completed",
  "payout.failed",
  "payout.unknown",
]);

type WebhookEnvelope = {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
};

function parseEnvelope(value: unknown): WebhookEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    typeof envelope.id !== "string" ||
    !/^tdp_evt_[A-Za-z0-9_-]{1,100}$/.test(envelope.id) ||
    typeof envelope.type !== "string" ||
    !supportedEventTypes.has(envelope.type) ||
    typeof envelope.createdAt !== "string" ||
    Number.isNaN(Date.parse(envelope.createdAt)) ||
    !envelope.data ||
    typeof envelope.data !== "object" ||
    Array.isArray(envelope.data)
  ) {
    return null;
  }
  return envelope as WebhookEnvelope;
}

export async function receiveTodoPayWebhook(req: Request, res: Response) {
  const secret = process.env.TODOPAY_WEBHOOK_SECRET ?? "";
  if (secret.length < 32) {
    logger.error("TODOPAY_WEBHOOK_SECRET is not configured");
    res.status(503).json({ error: "Webhook receiver is not configured" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Raw JSON body required" });
    return;
  }

  const eventId = req.get("X-TodoPay-Event-Id") ?? "";
  const eventType = req.get("X-TodoPay-Event-Type") ?? "";
  const timestamp = req.get("X-TodoPay-Timestamp") ?? "";
  const signatureHeader = req.get("X-TodoPay-Signature") ?? "";
  const rawBody = req.body.toString("utf8");

  if (
    !verifyTodoPayWebhook({
      secret,
      timestamp,
      eventId,
      rawBody,
      signatureHeader,
    })
  ) {
    logger.warn({ eventId, eventType }, "Rejected invalid TodoPay webhook signature");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const envelope = parseEnvelope(parsedBody);
  if (
    !envelope ||
    envelope.id !== eventId ||
    envelope.type !== eventType
  ) {
    res.status(400).json({ error: "Webhook envelope does not match headers" });
    return;
  }

  const [inserted] = await db
    .insert(todoPayWebhookEventsTable)
    .values({
      eventId: envelope.id,
      eventType: envelope.type,
      payload: envelope,
      signatureVersion: "v1",
    })
    .onConflictDoNothing()
    .returning({ id: todoPayWebhookEventsTable.id });

  logger.info(
    { eventId: envelope.id, eventType: envelope.type, duplicate: !inserted },
    "TodoPay webhook accepted",
  );
  res.status(200).json({ received: true, duplicate: !inserted });
}
