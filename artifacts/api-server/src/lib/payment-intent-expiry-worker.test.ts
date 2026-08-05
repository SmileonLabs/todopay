import { describe, expect, it } from "vitest";
import { isPaymentIntentExpirable } from "./payment-intent-expiry-state";

describe("payment intent expiry eligibility", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");

  it.each(["requires_member", "awaiting_deposit"])("expires %s at or before the deadline", (status) => {
    expect(isPaymentIntentExpirable(status, now, now)).toBe(true);
    expect(isPaymentIntentExpirable(status, new Date("2026-08-04T23:59:59.999Z"), now)).toBe(true);
  });

  it("does not expire settled, cancelled, or future intents", () => {
    expect(isPaymentIntentExpirable("succeeded", now, now)).toBe(false);
    expect(isPaymentIntentExpirable("cancelled", now, now)).toBe(false);
    expect(isPaymentIntentExpirable("awaiting_deposit", new Date("2026-08-05T00:00:00.001Z"), now)).toBe(false);
  });
});
