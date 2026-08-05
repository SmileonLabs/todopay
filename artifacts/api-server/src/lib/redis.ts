import IORedis from "ioredis";
import { logger } from "./logger.js";
import { config } from "../config.js";

const redisUrl = config.redisUrl;
if (config.isProduction && config.requireRedis && !redisUrl) {
  throw new Error("REDIS_URL must be set when REQUIRE_REDIS is enabled");
}

export const redis = redisUrl ? new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
}) : null;

redis?.on("error", (error) => logger.error({ error }, "Sellink Redis connection error"));

export async function connectRedis(): Promise<void> {
  if (!redis || redis.status === "ready" || redis.status === "connecting") return;
  await redis.connect();
}
