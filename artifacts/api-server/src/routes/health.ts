import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { redis } from "../lib/redis.js";
import { config } from "../config.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    if (config.requireRedis) {
      if (!redis || await redis.ping() !== "PONG") throw new Error("Redis is not ready");
    }
    res.json({ status: "ready", database: "ready", redis: redis ? "ready" : "not_configured" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

export default router;
