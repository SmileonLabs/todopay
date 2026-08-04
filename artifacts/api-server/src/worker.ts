import { startPaymentWorker } from "./lib/payment-queue.js";
import { connectRedis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";

await connectRedis();

const worker = startPaymentWorker(async (event) => {
  // This is intentionally fail-closed until the PG's signed webhook contract is configured.
  logger.info({ providerEventId: event.providerEventId, providerTransactionId: event.providerTransactionId }, "Payment event received by worker");
  throw new Error("Payment provider adapter has not been configured");
});

if (!worker) throw new Error("REDIS_URL is required to run the payment worker");
logger.info("Payment worker started");
