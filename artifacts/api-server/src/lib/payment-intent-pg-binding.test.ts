import { describe, expect, it } from "vitest";
import { createPaymentIntentTrackId, mapKpPayDepositToPaymentIntent } from "./payment-intent-pg-binding";

describe("payment intent KPPay track binding", () => {
  it("creates deterministic merchant/order/attempt-scoped IDs within the provider limit", () => {
    const first = createPaymentIntentTrackId({ merchantId: 42, merchantOrderId: "SELLINK-ORDER-20260805-0001", attemptNumber: 1 });
    expect(first).toBe(createPaymentIntentTrackId({ merchantId: 42, merchantOrderId: "SELLINK-ORDER-20260805-0001", attemptNumber: 1 }));
    expect(first.length).toBeLessThanOrEqual(50);
    expect(createPaymentIntentTrackId({ merchantId: 42, merchantOrderId: "SELLINK-ORDER-20260805-0001", attemptNumber: 2 })).not.toBe(first);
    expect(createPaymentIntentTrackId({ merchantId: 43, merchantOrderId: "SELLINK-ORDER-20260805-0001", attemptNumber: 1 })).not.toBe(first);
    expect(first).toContain("-A1-");
  });

  it("maps only an awaiting intent with exact track ID and exact integer amount", () => {
    const base = { status: "awaiting_deposit", expectedAmount: "15000", providerTrackingNumber: "TP42-ORDER-A1-abc", notificationTrackId: "TP42-ORDER-A1-abc", notificationAmount: "15000" };
    expect(mapKpPayDepositToPaymentIntent(base)).toEqual({ kind: "matched" });
    expect(mapKpPayDepositToPaymentIntent({ ...base, notificationTrackId: "other" })).toEqual({ kind: "track_mismatch" });
    expect(mapKpPayDepositToPaymentIntent({ ...base, notificationAmount: "15001" })).toEqual({ kind: "amount_mismatch" });
    expect(mapKpPayDepositToPaymentIntent({ ...base, status: "expired" })).toEqual({ kind: "not_payable" });
  });
});
