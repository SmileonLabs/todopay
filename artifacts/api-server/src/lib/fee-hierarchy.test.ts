import { describe, expect, it } from "vitest";
import {
  calculateDirectFeeShares,
  calculateResidualRate,
} from "./fee-hierarchy.js";

describe("direct usage fee allocation", () => {
  it("allocates direct organization shares and leaves the remainder to the store", () => {
    const shares = calculateDirectFeeShares(100_000, 10, 10, [
      { userId: 20, rate: 0 },
      { userId: 30, rate: 3 },
      { userId: 40, rate: 5 },
    ]);

    expect(shares).toEqual([
      { userId: 10, rate: 2, amount: 2_000 },
      { userId: 20, rate: 0, amount: 0 },
      { userId: 30, rate: 3, amount: 3_000 },
      { userId: 40, rate: 5, amount: 5_000 },
    ]);
  });

  it("keeps rounded direct allocations equal to the collected fee", () => {
    const shares = calculateDirectFeeShares(50, 10, 10, [
      { userId: 20, rate: 3 },
      { userId: 30, rate: 3 },
      { userId: 40, rate: 2 },
    ]);

    expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(5);
  });

  it("rejects direct allocations above the store total rate", () => {
    expect(() => calculateDirectFeeShares(100_000, 10, 10, [
      { userId: 20, rate: 6 },
      { userId: 30, rate: 5 },
    ])).toThrow("FEE_ALLOCATION_EXCEEDS_TOTAL");
  });

  it("returns the same residual regardless of the viewer", () => {
    expect(calculateResidualRate(10, [2, 2])).toEqual({
      allocatedRate: 4,
      residualRate: 6,
    });
  });
});
