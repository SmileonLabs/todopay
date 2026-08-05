import app from "./app";
import { logger } from "./lib/logger";
import { connectRedis } from "./lib/redis.js";
import { startMerchantWebhookDispatcher } from "./lib/merchant-webhook-dispatcher.js";
import { startPayoutSubmissionWorker } from "./lib/payout-submission-worker.js";
import { startPaymentEventWorker } from "./lib/payment-event-worker.js";
import { startReconciliationWorker } from "./lib/reconciliation-worker.js";
import { startPaymentIntentExpiryWorker } from "./lib/payment-intent-expiry-worker.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
const host = process.env["HOST"] ?? "0.0.0.0";

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await connectRedis();
startMerchantWebhookDispatcher();
startPayoutSubmissionWorker();
startPaymentEventWorker();
startReconciliationWorker();
startPaymentIntentExpiryWorker();

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");
});
