import { describe, expect, it } from "vitest";
import { isPaymentIntentMemberReplay } from "./payment-intent-state";

describe("payment intent member attachment state", () => {
  it.each(["awaiting_deposit", "processing", "succeeded", "amount_mismatch", "reversed"])(
    "accepts an identical member replay in %s",
    (status) => expect(isPaymentIntentMemberReplay(status, 7, 7)).toBe(true),
  );

  it("rejects a different member and terminal cancellation states", () => {
    expect(isPaymentIntentMemberReplay("awaiting_deposit", 7, 8)).toBe(false);
    expect(isPaymentIntentMemberReplay("cancelled", 7, 7)).toBe(false);
    expect(isPaymentIntentMemberReplay("expired", 7, 7)).toBe(false);
    expect(isPaymentIntentMemberReplay("requires_member", 7, 7)).toBe(false);
  });
});

