function optionalString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function booleanValue(name: string, fallback = false): boolean {
  const value = optionalString(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false"`);
}

function positiveInteger(name: string, fallback: number): number {
  const value = optionalString(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const isProduction = process.env.NODE_ENV === "production";

function urlValue(name: string, value?: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !isProduction)) {
    throw new Error(`${name} must use HTTPS in production`);
  }
  return url.toString().replace(/\/$/, "");
}

function originValue(name: string, value: string): string {
  const normalized = urlValue(name, value)!;
  const url = new URL(normalized);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} entries must be origins without credentials, paths, queries, or fragments`);
  }
  return url.origin;
}

const corsOrigins = (optionalString("CORS_ORIGINS") ?? (isProduction ? "" : "http://localhost:5173"))
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean)
  .map(origin => originValue("CORS_ORIGINS", origin));

if (isProduction && corsOrigins.length === 0) {
  throw new Error("CORS_ORIGINS must be configured in production");
}

const sessionSecret = optionalString("SESSION_SECRET");
if (isProduction && (!sessionSecret || sessionSecret.length < 64)) {
  throw new Error("SESSION_SECRET must contain at least 64 characters in production");
}

const otpEncryptionKey = optionalString("OTP_ENCRYPTION_KEY");
if (isProduction && (!otpEncryptionKey || otpEncryptionKey.length < 32)) {
  throw new Error("OTP_ENCRYPTION_KEY must contain at least 32 characters in production");
}

export const config = Object.freeze({
  isProduction,
  port: positiveInteger("PORT", 8080),
  trustProxyHops: positiveInteger("TRUST_PROXY_HOPS", 1),
  corsOrigins,
  apiRateLimit: positiveInteger("API_RATE_LIMIT_PER_MINUTE", 600),
  loginRateLimit: positiveInteger("LOGIN_RATE_LIMIT", 10),
  loginRateWindowSeconds: positiveInteger("LOGIN_RATE_WINDOW_SECONDS", 900),
  sessionTtlMs: positiveInteger("SESSION_TTL_SECONDS", 86_400) * 1000,
  adminSessionCookieName: optionalString("ADMIN_SESSION_COOKIE_NAME")
    ?? (isProduction ? "__Host-sellink_admin" : "sellink_admin"),
  memberSessionCookieName: optionalString("MEMBER_SESSION_COOKIE_NAME")
    ?? (isProduction ? "__Host-sellink_member" : "sellink_member"),
  todoPayRequestTimeoutMs: positiveInteger("TODOPAY_REQUEST_TIMEOUT_MS", 15_000),
  jsonBodyLimit: optionalString("JSON_BODY_LIMIT") ?? "256kb",
  formBodyLimit: optionalString("FORM_BODY_LIMIT") ?? "64kb",
  webhookBodyLimit: optionalString("WEBHOOK_BODY_LIMIT") ?? "64kb",
  logLevel: optionalString("LOG_LEVEL") ?? "info",
  sessionSecret,
  otpEncryptionKey,
  redisUrl: optionalString("REDIS_URL"),
  requireRedis: booleanValue("REQUIRE_REDIS"),
  paymentIntegrationEnabled: booleanValue("PAYMENT_INTEGRATION_ENABLED"),
  todoPayApiBaseUrl: urlValue(
    "TODOPAY_API_BASE_URL",
    optionalString("TODOPAY_API_BASE_URL")
      ?? (isProduction ? undefined : "https://api.todopay.io"),
  ),
  todoPayApiKey: optionalString("TODOPAY_API_KEY"),
  todoPayWebhookSecret: optionalString("TODOPAY_WEBHOOK_SECRET"),
  publicAppUrl: urlValue(
    "PUBLIC_APP_URL",
    optionalString("PUBLIC_APP_URL")
      ?? corsOrigins[0]
      ?? (isProduction ? undefined : "http://localhost:5173"),
  ),
});
