import { describe, expect, test } from "vitest";
import { canApplyPayoutNotification, needsWithdrawalRefund } from "./payment-state";

describe("payout state machine", () => {
  test("never settles an unapproved withdrawal", () => {
    expect(canApplyPayoutNotification("pending", "processing", "paid")).toBe(false);
  });
  test("accepts exactly the provider terminal transitions", () => {
    expect(canApplyPayoutNotification("approved", "submitting", "paid")).toBe(true);
    expect(canApplyPayoutNotification("approved", "processing", "paid")).toBe(true);
    expect(canApplyPayoutNotification("approved", "paid", "failed")).toBe(true);
    expect(canApplyPayoutNotification("approved", "failed", "paid")).toBe(false);
  });
  test("refunds only failed or indeterminate payouts", () => {
    expect(needsWithdrawalRefund("paid")).toBe(false);
    expect(needsWithdrawalRefund("failed")).toBe(true);
    expect(needsWithdrawalRefund("unknown")).toBe(true);
  });
});
