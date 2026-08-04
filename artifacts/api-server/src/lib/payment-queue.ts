import { Queue, Worker } from "bullmq";
import { logger } from "./logger.js";
import { redis } from "./redis.js";

export type PaymentEventJob = {
  providerEventId: string;
  providerTransactionId: string;
  occurredAt: string;
};

const queueName = "todopay-payment-events";

export const paymentQueue = redis
  ? new Queue<PaymentEventJob>(queueName, { connection: redis, defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
    } })
  : null;

/** The PG-specific worker will be wired after the provider's signed webhook contract is received. */
export function startPaymentWorker(processor: (job: PaymentEventJob) => Promise<void>): Worker<PaymentEventJob> | null {
  if (!redis) return null;
  const worker = new Worker<PaymentEventJob>(queueName, async (job) => processor(job.data), {
    connection: redis,
    concurrency: Number(process.env.PAYMENT_WORKER_CONCURRENCY ?? 10),
  });
  worker.on("failed", (job, err) => logger.error({ err, jobId: job?.id }, "Payment queue job failed"));
  return worker;
}

export async function enqueuePaymentEvent(event: PaymentEventJob): Promise<void> {
  if (!paymentQueue) throw new Error("Payment queue is unavailable: configure REDIS_URL");
  await paymentQueue.add("payment-event", event, { jobId: event.providerEventId });
}
