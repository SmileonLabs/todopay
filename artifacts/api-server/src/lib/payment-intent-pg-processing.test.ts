import { describe, expect, it } from "vitest";
import {
  isPaymentIntentMerchantWebhookEnabled,
  isPaymentIntentPgProcessingEnabled,
  planPaymentIntentProviderEvent,
} from "./payment-intent-pg-processing";

const base = {
  status: "awaiting_deposit",
  expectedAmount: "15000",
  providerTrackingNumber: "TP1-ORDER-A1-abc",
  notificationTrackId: "TP1-ORDER-A1-abc",
  notificationAmount: "15000",
  transactionType: "deposit" as const,
};

describe("payment intent provider event plan", () => {
  it("completes only an exact payable deposit", () => {
    expect(planPaymentIntentProviderEvent(base)).toBe("complete");
    expect(planPaymentIntentProviderEvent({ ...base, notificationTrackId: "other" })).toBe("reject");
    expect(planPaymentIntentProviderEvent({ ...base, notificationAmount: "15001" })).toBe("amount_mismatch");
  });

  it("is replay-safe after a concurrent winner completes", () => {
    expect(planPaymentIntentProviderEvent({ ...base, status: "succeeded" })).toBe("duplicate");
    expect(planPaymentIntentProviderEvent({ ...base, status: "succeeded", notificationAmount: "15001" })).toBe("reject");
    expect(planPaymentIntentProviderEvent({ ...base, status: "amount_mismatch" })).toBe("duplicate");
  });

  it("reverses only a matching succeeded intent and deduplicates the replay", () => {
    expect(planPaymentIntentProviderEvent({ ...base, status: "succeeded", transactionType: "depositback" })).toBe("reverse");
    expect(planPaymentIntentProviderEvent({ ...base, status: "reversed", transactionType: "depositback" })).toBe("duplicate");
    expect(planPaymentIntentProviderEvent({ ...base, status: "awaiting_deposit", transactionType: "depositback" })).toBe("reject");
  });

  it("keeps both live processing and merchant webhook delivery disabled by default", () => {
    expect(isPaymentIntentPgProcessingEnabled({})).toBe(false);
    expect(isPaymentIntentMerchantWebhookEnabled({})).toBe(false);
    expect(isPaymentIntentPgProcessingEnabled({ PAYMENT_PROVIDER_ENABLED: "true", PAYMENT_INTENT_PG_TRACK_BINDING_ENABLED: "true" })).toBe(true);
    expect(isPaymentIntentMerchantWebhookEnabled({
      PAYMENT_INTENT_MERCHANT_WEBHOOK_ENABLED: "true",
      WEBHOOK_DISPATCH_ENABLED: "true",
      WEBHOOK_MASTER_SECRET: "m".repeat(32),
    })).toBe(true);
  });
});
