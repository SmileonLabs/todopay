import { db, paymentIntentEventsTable, paymentIntentsTable } from "@workspace/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { paymentIntentExpirableStatuses } from "./payment-intent-expiry-state.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;

/**
 * Expires only unpaid intents. The conditional update is the race guard: multiple
 * workers may observe a candidate, but exactly one can transition its status.
 */
export async function expirePaymentIntents(now = new Date(), batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
  const candidates = await db.select().from(paymentIntentsTable).where(and(
    inArray(paymentIntentsTable.status, [...paymentIntentExpirableStatuses]),
    lte(paymentIntentsTable.expiresAt, now),
  )).limit(Math.max(1, Math.min(500, batchSize)));

  let expiredCount = 0;
  for (const candidate of candidates) {
    const expired = await db.transaction(async (tx) => {
      const [changed] = await tx.update(paymentIntentsTable).set({
        status: "expired",
        updatedAt: now,
        version: sql`${paymentIntentsTable.version} + 1`,
      }).where(and(
        eq(paymentIntentsTable.id, candidate.id),
        inArray(paymentIntentsTable.status, [...paymentIntentExpirableStatuses]),
        lte(paymentIntentsTable.expiresAt, now),
      )).returning();
      if (!changed) return false;
      await tx.insert(paymentIntentEventsTable).values({
        paymentIntentId: changed.id,
        eventType: "payment_intent.expired",
        source: "payment_intent_expiry_worker",
        sourceEventId: `expiry:${changed.publicId}`,
        payload: {
          fromStatus: candidate.status,
          status: changed.status,
          expiresAt: changed.expiresAt.toISOString(),
        },
      }).onConflictDoNothing();
      return true;
    });
    if (expired) expiredCount += 1;
  }
  return expiredCount;
}

export function startPaymentIntentExpiryWorker() {
  if (process.env.PAYMENT_INTENT_EXPIRY_WORKER_ENABLED !== "true") {
    logger.info("Payment intent expiry worker is disabled");
    return () => undefined;
  }
  const intervalMs = Math.max(
    10_000,
    Number(process.env.PAYMENT_INTENT_EXPIRY_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
  );
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const expired = await expirePaymentIntents();
      if (expired > 0) logger.info({ expired }, "Payment intents expired");
    } catch (error) {
      logger.error({ err: error }, "Payment intent expiry worker failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  logger.info({ intervalMs }, "Payment intent expiry worker started");
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
