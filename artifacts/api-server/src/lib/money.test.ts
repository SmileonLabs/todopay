import { describe, expect, test } from "vitest";
import { calculateUsageFee, calculateWithdrawal, percentToBasisPoints, requireKrwAmount } from "./money";

describe("money rules", () => {
  test("rejects fractional and unsafe KRW amounts", () => {
    expect(() => requireKrwAmount(10.5)).toThrow();
    expect(() => requireKrwAmount(0)).toThrow();
  });
  test("calculates withdrawal reserve and payout exactly", () => {
    expect(calculateWithdrawal(10_000, 300)).toEqual({ reservedAmount: 10_000, fee: 300, payoutAmount: 9_700 });
  });
  test("uses basis points for fee calculations", () => {
    expect(percentToBasisPoints("1.25")).toBe(125);
    expect(calculateUsageFee(10_000, "1.25")).toBe(125);
  });
});
