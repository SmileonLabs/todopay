import crypto from "node:crypto";

const WEBHOOK_CONTEXT = "todopay-merchant-webhook";

export function deriveMerchantWebhookSecret(
  masterSecret: string,
  merchantCode: string,
  version: number,
) {
  if (masterSecret.length < 32) {
    throw new Error("WEBHOOK_MASTER_SECRET must be at least 32 characters");
  }
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error("Invalid webhook secret version");
  }

  return crypto
    .createHmac("sha256", masterSecret)
    .update(`${WEBHOOK_CONTEXT}:${merchantCode}:${version}`, "utf8")
    .digest("base64url");
}

export function signMerchantWebhook(
  secret: string,
  timestamp: string,
  eventId: string,
  rawBody: string,
) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${rawBody}`, "utf8")
    .digest("hex");
}
