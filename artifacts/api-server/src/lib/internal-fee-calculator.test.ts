import { describe, expect, it } from "vitest";
import {
  calculateInternalSettlement,
  reverseInternalSettlement,
  type InternalFeePolicy,
} from "./internal-fee-calculator.js";

const policy: InternalFeePolicy = {
  storeId: 10,
  storeName: "매장",
  totalRate: 10,
  depositFee: 1_000,
  withdrawalFee: 1_000,
  organizationRates: [
    { userId: 20, role: "agency", name: "대리점", rate: 2 },
    { userId: 30, role: "distributor", name: "총판", rate: 2 },
    { userId: 40, role: "hq", name: "본사", rate: 3 },
  ],
};

describe("Sellink internal settlement allocation", () => {
  it("splits the configured 10% and conserves the TodoPay settlement", () => {
    const result = calculateInternalSettlement({
      grossAmount: 100_000,
      todoPayFee: 1_000,
      settlementAmount: 99_000,
      policy,
    });

    expect(result.internalFeeAmount).toBe(10_000);
    expect(result.storeCommissionAmount).toBe(3_000);
    expect(result.entries).toEqual([
      {
        beneficiaryUserId: 10,
        role: "store",
        name: "매장",
        rate: 3,
        amount: 92_000,
        commissionAmount: 3_000,
        component: "store_settlement",
      },
      {
        beneficiaryUserId: 20,
        role: "agency",
        name: "대리점",
        rate: 2,
        amount: 2_000,
        commissionAmount: 2_000,
        component: "organization_commission",
      },
      {
        beneficiaryUserId: 30,
        role: "distributor",
        name: "총판",
        rate: 2,
        amount: 2_000,
        commissionAmount: 2_000,
        component: "organization_commission",
      },
      {
        beneficiaryUserId: 40,
        role: "hq",
        name: "본사",
        rate: 3,
        amount: 3_000,
        commissionAmount: 3_000,
        component: "organization_commission",
      },
    ]);
    expect(result.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(
      result.settlementAmount,
    );
  });

  it("does not lose a won when percentage amounts require rounding", () => {
    const result = calculateInternalSettlement({
      grossAmount: 53,
      todoPayFee: 3,
      settlementAmount: 50,
      policy,
    });

    expect(result.internalFeeAmount).toBe(5);
    expect(result.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(50);
    expect(result.entries.reduce(
      (sum, entry) => sum + entry.commissionAmount,
      0,
    )).toBe(5);
  });

  it("rejects an organization allocation above the store total", () => {
    expect(() => calculateInternalSettlement({
      grossAmount: 100_000,
      todoPayFee: 1_000,
      settlementAmount: 99_000,
      policy: {
        ...policy,
        organizationRates: [
          { userId: 20, role: "agency", name: "대리점", rate: 6 },
          { userId: 30, role: "distributor", name: "총판", rate: 5 },
        ],
      },
    })).toThrow("FEE_ALLOCATION_EXCEEDS_TOTAL");
  });

  it("rejects an inconsistent TodoPay settlement", () => {
    expect(() => calculateInternalSettlement({
      grossAmount: 100_000,
      todoPayFee: 1_000,
      settlementAmount: 98_999,
      policy,
    })).toThrow("TODOPAY_SETTLEMENT_CONSERVATION_FAILED");
  });

  it("reverses the exact original entries without recalculation", () => {
    const original = calculateInternalSettlement({
      grossAmount: 100_000,
      todoPayFee: 1_000,
      settlementAmount: 99_000,
      policy,
    });
    const reversal = reverseInternalSettlement(original);

    for (let index = 0; index < original.entries.length; index += 1) {
      expect(reversal.entries[index].amount).toBe(-original.entries[index].amount);
      expect(reversal.entries[index].commissionAmount).toBe(
        -original.entries[index].commissionAmount,
      );
    }
    expect(reversal.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(
      -99_000,
    );
  });
});
