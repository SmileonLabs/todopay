import crypto from "node:crypto";

export function signTodoPayWebhook(
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

export function verifyTodoPayWebhook(params: {
  secret: string;
  timestamp: string;
  eventId: string;
  rawBody: string;
  signatureHeader: string;
  nowSeconds?: number;
}) {
  const {
    secret,
    timestamp,
    eventId,
    rawBody,
    signatureHeader,
    nowSeconds = Math.floor(Date.now() / 1_000),
  } = params;
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > 300
  ) {
    return false;
  }
  const match = /^v1=([a-f0-9]{64})$/i.exec(signatureHeader);
  if (!match) return false;

  const expected = Buffer.from(
    signTodoPayWebhook(secret, timestamp, eventId, rawBody),
    "hex",
  );
  const supplied = Buffer.from(match[1], "hex");
  return (
    expected.length === supplied.length &&
    crypto.timingSafeEqual(expected, supplied)
  );
}
