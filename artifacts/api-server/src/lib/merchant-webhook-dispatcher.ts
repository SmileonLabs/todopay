import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import {
  deriveMerchantWebhookSecret,
  signMerchantWebhook,
} from "./merchant-webhook-signing.js";

const DEFAULT_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 10;
const MAX_RESPONSE_BYTES = 8_192;
const dispatcherId = `${process.env.HOSTNAME ?? "api"}:${process.pid}:${crypto.randomUUID()}`;

type ClaimedDelivery = {
  id: number;
  eventId: string;
  merchantId: number;
  merchantCode: string;
  webhookUrl: string | null;
  webhookSecretVersion: number;
  eventType: string;
  payload: unknown;
  attemptCount: number;
};

type ResolvedTarget = {
  url: URL;
  address: string;
};

function isBlockedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isBlockedWebhookAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family !== 6) return true;

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return net.isIP(mapped) !== 4 || isBlockedIpv4(mapped);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

export async function resolveSafeWebhookTarget(rawUrl: string): Promise<ResolvedTarget> {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Webhook target must be an HTTPS URL on port 443");
  }
  if (
    url.hostname.toLowerCase() === "localhost" ||
    url.hostname.toLowerCase().endsWith(".local")
  ) {
    throw new Error("Webhook target host is not allowed");
  }

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Webhook target could not be resolved");
  if (addresses.some(({ address }) => isBlockedWebhookAddress(address))) {
    throw new Error("Webhook target resolves to a private or reserved address");
  }

  return { url, address: addresses[0].address };
}

function retryDelayMs(attemptCount: number) {
  const schedule = [
    30_000,
    60_000,
    120_000,
    300_000,
    900_000,
    1_800_000,
    3_600_000,
    7_200_000,
    14_400_000,
  ];
  return schedule[Math.min(Math.max(attemptCount - 1, 0), schedule.length - 1)];
}

async function claimDelivery(): Promise<ClaimedDelivery | null> {
  const result = await pool.query<{
    id: number;
    event_id: string;
    merchant_id: number;
    merchant_code: string;
    webhook_url: string | null;
    webhook_secret_version: number;
    event_type: string;
    payload: unknown;
    attempt_count: number;
  }>(
    `
      WITH candidate AS (
        SELECT delivery.id
        FROM merchant_webhook_deliveries delivery
        WHERE (
          delivery.status IN ('pending', 'retry')
          AND delivery.next_attempt_at <= NOW()
        ) OR (
          delivery.status = 'processing'
          AND delivery.locked_at < NOW() - INTERVAL '2 minutes'
        )
        ORDER BY delivery.next_attempt_at ASC, delivery.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE merchant_webhook_deliveries delivery
      SET status = 'processing',
          locked_at = NOW(),
          locked_by = $1,
          last_attempt_at = NOW(),
          updated_at = NOW()
      FROM candidate, merchants merchant
      WHERE delivery.id = candidate.id
        AND merchant.id = delivery.merchant_id
      RETURNING
        delivery.id,
        delivery.event_id,
        delivery.merchant_id,
        merchant.code AS merchant_code,
        merchant.webhook_url,
        merchant.webhook_secret_version,
        delivery.event_type,
        delivery.payload,
        delivery.attempt_count
    `,
    [dispatcherId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        eventId: row.event_id,
        merchantId: row.merchant_id,
        merchantCode: row.merchant_code,
        webhookUrl: row.webhook_url,
        webhookSecretVersion: row.webhook_secret_version,
        eventType: row.event_type,
        payload: row.payload,
        attemptCount: row.attempt_count,
      }
    : null;
}

async function postPinnedJson(
  target: ResolvedTarget,
  headers: Record<string, string>,
  rawBody: string,
) {
  return new Promise<number>((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: target.address,
        port: 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        servername: target.url.hostname,
        headers: {
          ...headers,
          Host: target.url.host,
          "Content-Length": Buffer.byteLength(rawBody).toString(),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) response.destroy();
        });
        response.on("end", () => resolve(response.statusCode ?? 0));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Webhook request timed out")));
    request.on("error", reject);
    request.end(rawBody);
  });
}

async function markDelivered(id: number, responseStatus: number) {
  await pool.query(
    `
      UPDATE merchant_webhook_deliveries
      SET status = 'delivered',
          attempt_count = attempt_count + 1,
          delivered_at = NOW(),
          response_status = $2,
          last_error = NULL,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1 AND locked_by = $3
    `,
    [id, responseStatus, dispatcherId],
  );
}

async function markFailed(
  delivery: ClaimedDelivery,
  error: unknown,
  responseStatus: number | null,
) {
  const attemptCount = delivery.attemptCount + 1;
  const isDead = attemptCount >= MAX_ATTEMPTS;
  const message = error instanceof Error ? error.message : String(error);
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(attemptCount));
  await pool.query(
    `
      UPDATE merchant_webhook_deliveries
      SET status = $2,
          attempt_count = $3,
          next_attempt_at = $4,
          response_status = $5,
          last_error = $6,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1 AND locked_by = $7
    `,
    [
      delivery.id,
      isDead ? "dead" : "retry",
      attemptCount,
      nextAttemptAt,
      responseStatus,
      message.slice(0, 1_000),
      dispatcherId,
    ],
  );
  logger.warn(
    {
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      attemptCount,
      dead: isDead,
      responseStatus,
      err: error,
    },
    "Merchant webhook delivery failed",
  );
}

async function deliverOne(delivery: ClaimedDelivery, masterSecret: string) {
  if (!delivery.webhookUrl) {
    await markFailed(delivery, new Error("Merchant webhook URL is not configured"), null);
    return;
  }

  let responseStatus: number | null = null;
  try {
    const target = await resolveSafeWebhookTarget(delivery.webhookUrl);
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const rawBody = JSON.stringify(delivery.payload);
    const secret = deriveMerchantWebhookSecret(
      masterSecret,
      delivery.merchantCode,
      delivery.webhookSecretVersion,
    );
    const signature = signMerchantWebhook(
      secret,
      timestamp,
      delivery.eventId,
      rawBody,
    );
    responseStatus = await postPinnedJson(
      target,
      {
        "Content-Type": "application/json",
        "User-Agent": "TodoPay-Webhook/1.0",
        "X-TodoPay-Event-Id": delivery.eventId,
        "X-TodoPay-Event-Type": delivery.eventType,
        "X-TodoPay-Timestamp": timestamp,
        "X-TodoPay-Signature": `v1=${signature}`,
      },
      rawBody,
    );
    if (responseStatus < 200 || responseStatus >= 300) {
      throw new Error(`Webhook endpoint returned HTTP ${responseStatus}`);
    }
    await markDelivered(delivery.id, responseStatus);
    logger.info(
      {
        deliveryId: delivery.id,
        eventId: delivery.eventId,
        merchantId: delivery.merchantId,
        responseStatus,
      },
      "Merchant webhook delivered",
    );
  } catch (error) {
    await markFailed(delivery, error, responseStatus);
  }
}

export function startMerchantWebhookDispatcher() {
  if (process.env.WEBHOOK_DISPATCH_ENABLED !== "true") {
    logger.info("Merchant webhook dispatcher is disabled");
    return () => undefined;
  }

  const masterSecret = process.env.WEBHOOK_MASTER_SECRET ?? "";
  if (masterSecret.length < 32) {
    throw new Error(
      "WEBHOOK_MASTER_SECRET must be configured with at least 32 characters",
    );
  }

  const intervalMs = Math.max(
    500,
    Number.parseInt(
      process.env.WEBHOOK_DISPATCH_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
      10,
    ) || DEFAULT_INTERVAL_MS,
  );
  let running = false;
  let stopped = false;

  const poll = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (let count = 0; count < 10; count += 1) {
        const delivery = await claimDelivery();
        if (!delivery) break;
        await deliverOne(delivery, masterSecret);
      }
    } catch (error) {
      logger.error({ err: error }, "Merchant webhook dispatcher poll failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  void poll();
  logger.info({ intervalMs, dispatcherId }, "Merchant webhook dispatcher started");

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
