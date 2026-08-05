export type PaymentIntentProviderAction =
  | "complete"
  | "amount_mismatch"
  | "reverse"
  | "duplicate"
  | "reject";

export function planPaymentIntentProviderEvent(input: {
  status: string;
  expectedAmount: string;
  providerTrackingNumber: string | null;
  notificationTrackId: string;
  notificationAmount: string;
  transactionType: "deposit" | "depositback";
}): PaymentIntentProviderAction {
  const exactTrack = Boolean(input.providerTrackingNumber)
    && input.providerTrackingNumber === input.notificationTrackId;
  if (!exactTrack) return "reject";

  if (input.transactionType === "depositback") {
    if (input.status === "reversed") {
      return input.expectedAmount === input.notificationAmount ? "duplicate" : "reject";
    }
    return input.status === "succeeded" && input.expectedAmount === input.notificationAmount
      ? "reverse"
      : "reject";
  }

  if (input.status === "succeeded") {
    return input.expectedAmount === input.notificationAmount ? "duplicate" : "reject";
  }
  if (input.status === "amount_mismatch") return "duplicate";
  if (input.status !== "awaiting_deposit") return "reject";
  return input.expectedAmount === input.notificationAmount ? "complete" : "amount_mismatch";
}

export function isPaymentIntentPgProcessingEnabled(env = process.env): boolean {
  return env.PAYMENT_PROVIDER_ENABLED === "true"
    && env.PAYMENT_INTENT_PG_TRACK_BINDING_ENABLED === "true";
}

export function isPaymentIntentMerchantWebhookEnabled(env = process.env): boolean {
  return env.PAYMENT_INTENT_MERCHANT_WEBHOOK_ENABLED === "true"
    && env.WEBHOOK_DISPATCH_ENABLED === "true"
    && (env.WEBHOOK_MASTER_SECRET?.length ?? 0) >= 32;
}
