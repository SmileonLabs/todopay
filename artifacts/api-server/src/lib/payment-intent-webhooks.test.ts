import { describe, expect, it } from "vitest";
import { buildPaymentIntentWebhook } from "./payment-intent-webhooks";

describe("payment intent merchant webhook contract", () => {
  it("keeps merchant references and KRW amount as a string", () => {
    const payload = buildPaymentIntentWebhook({
      eventId: "tdp_evt_pi_created_pi_123",
      eventType: "payment_intent.created",
      paymentIntentId: "pi_123",
      merchantOrderId: "ORDER-20260805-1",
      externalCustomerId: "customer-42",
      memberId: 11,
      amount: "15000",
      currency: "KRW",
      status: "awaiting_deposit",
      occurredAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(payload.data).toMatchObject({
      paymentIntentId: "pi_123",
      merchantOrderId: "ORDER-20260805-1",
      externalCustomerId: "customer-42",
      memberId: 11,
      amount: "15000",
      currency: "KRW",
      status: "awaiting_deposit",
    });
    expect(payload.createdAt).toBe("2026-08-05T00:00:00.000Z");
    expect(typeof payload.data.amount).toBe("string");
  });

  it("rejects fractional or numeric-style KRW values", () => {
    expect(() => buildPaymentIntentWebhook({
      eventId: "event",
      eventType: "payment_intent.created",
      paymentIntentId: "pi_123",
      merchantOrderId: "ORDER-1",
      externalCustomerId: null,
      memberId: null,
      amount: "10.00",
      currency: "KRW",
      status: "requires_member",
    })).toThrow(/positive integer string/);
  });
});

