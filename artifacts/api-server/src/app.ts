import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { receiveTodoPayWebhook } from "./routes/todopay-webhooks";
import { allowRequest } from "./lib/rate-limit.js";

const app: Express = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const supplied = req.get("X-Request-Id");
  const requestId = supplied && /^[A-Za-z0-9._-]{8,100}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const configuredOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && configuredOrigins.length === 0) {
  throw new Error("CORS_ORIGINS must be configured in production");
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id", "X-TOTP-Code"],
  maxAge: 600,
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
  ].join("; "));
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
// The raw request bytes are required for HMAC verification. This route must
// remain before the global JSON parser below.
app.post(
  "/api/webhooks/todopay",
  express.raw({ type: "application/json", limit: "64kb" }),
  receiveTodoPayWebhook,
);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use("/api", async (req, res, next) => {
  const requestIp = (req.ip ?? "unknown").replace(/^::ffff:/, "");
  const allowed = await allowRequest("admin-api", requestIp, {
    limit: 600,
    windowSeconds: 60,
  });
  if (!allowed) {
    res.status(429).json({
      error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      code: "RATE_LIMITED",
    });
    return;
  }
  next();
});
app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "요청한 API를 찾을 수 없습니다." });
});
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const errorStatus = typeof error === "object" && error !== null
    ? Number((error as { status?: unknown; statusCode?: unknown }).status
      ?? (error as { statusCode?: unknown }).statusCode)
    : NaN;
  const status = Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus < 500
    ? errorStatus
    : 500;
  if (status < 500) {
    req.log.warn({ err: error }, "client request rejected");
  } else {
    req.log.error({ err: error }, "request failed");
  }
  res.status(status).json({
    error: status === 400
      ? "요청 형식이 올바르지 않습니다."
      : "서버에서 요청을 처리하지 못했습니다.",
    requestId: res.getHeader("X-Request-Id"),
  });
});

// The Sellink console is served by the same private API task in production.
// This keeps its browser/API origin identical and avoids a separate public API
// domain or permissive cross-origin credential policy.
if (process.env.NODE_ENV === "production") {
  const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(runtimeDir, "../public");
  app.use(express.static(publicDir, { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

export default app;
