import { calculateDirectFeeShares } from "./fee-hierarchy.js";

export type InternalFeeRate = {
  userId: number;
  role: string;
  name: string;
  rate: number;
};

export type InternalFeePolicy = {
  storeId: number;
  storeName: string;
  totalRate: number;
  depositFee: number;
  withdrawalFee: number;
  organizationRates: InternalFeeRate[];
};

export type InternalFeeAllocationEntry = {
  beneficiaryUserId: number;
  role: string;
  name: string;
  rate: number;
  amount: number;
  commissionAmount: number;
  component: "store_settlement" | "organization_commission";
};

export type InternalSettlementAllocation = {
  grossAmount: number;
  todoPayFee: number;
  settlementAmount: number;
  internalFeeAmount: number;
  storeCommissionAmount: number;
  entries: InternalFeeAllocationEntry[];
};

function assertWonAmount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name}_MUST_BE_NON_NEGATIVE_INTEGER_WON`);
  }
}
function assertRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name}_MUST_BE_BETWEEN_0_AND_100`);
  }
  if (Math.round(value * 100) !== value * 100) {
    throw new Error(`${name}_MAXIMUM_TWO_DECIMAL_PLACES`);
  }
}

/**
 * Allocates the exact TodoPay settlement amount inside Sellink.
 *
 * The configured percentage pool is calculated from the gross payment. Direct
 * organization shares are credited independently. The store receives the
 * remaining settlement, which includes its own commission share and principal.
 * Therefore every won is conserved:
 *
 *   store settlement + organization commissions = TodoPay settlement
 */
export function calculateInternalSettlement(input: {
  grossAmount: number;
  todoPayFee: number;
  settlementAmount: number;
  policy: InternalFeePolicy;
}): InternalSettlementAllocation {
  assertWonAmount("GROSS_AMOUNT", input.grossAmount);
  assertWonAmount("TODOPAY_FEE", input.todoPayFee);
  assertWonAmount("SETTLEMENT_AMOUNT", input.settlementAmount);
  assertRate("TOTAL_RATE", input.policy.totalRate);

  if (input.todoPayFee > input.grossAmount) {
    throw new Error("TODOPAY_FEE_EXCEEDS_GROSS_AMOUNT");
  }
  if (input.settlementAmount > input.grossAmount) {
    throw new Error("SETTLEMENT_AMOUNT_EXCEEDS_GROSS_AMOUNT");
  }
  if (input.grossAmount - input.todoPayFee !== input.settlementAmount) {
    throw new Error("TODOPAY_SETTLEMENT_CONSERVATION_FAILED");
  }

  for (const item of input.policy.organizationRates) {
    assertRate(`ORGANIZATION_RATE_${item.userId}`, item.rate);
  }

  const directShares = calculateDirectFeeShares(
    input.grossAmount,
    input.policy.totalRate,
    input.policy.storeId,
    input.policy.organizationRates.map(item => ({
      userId: item.userId,
      rate: item.rate,
    })),
  );

  const identity = new Map<number, { role: string; name: string }>([
    [input.policy.storeId, { role: "store", name: input.policy.storeName }],
    ...input.policy.organizationRates.map(item => [
      item.userId,
      { role: item.role, name: item.name },
    ] as const),
  ]);
  const storeShare = directShares.find(item => item.userId === input.policy.storeId);
  if (!storeShare) throw new Error("STORE_SHARE_MISSING");

  const organizationShares = directShares.filter(
    item => item.userId !== input.policy.storeId,
  );
  const organizationCommissionTotal = organizationShares.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  if (organizationCommissionTotal > input.settlementAmount) {
    throw new Error("ORGANIZATION_COMMISSION_EXCEEDS_SETTLEMENT");
  }

  const storeSettlementAmount =
    input.settlementAmount - organizationCommissionTotal;
  const entries: InternalFeeAllocationEntry[] = [
    {
      beneficiaryUserId: input.policy.storeId,
      role: "store",
      name: input.policy.storeName,
      rate: storeShare.rate,
      amount: storeSettlementAmount,
      commissionAmount: storeShare.amount,
      component: "store_settlement",
    },
    ...organizationShares.map(item => ({
      beneficiaryUserId: item.userId,
      role: identity.get(item.userId)?.role ?? "organization",
      name: identity.get(item.userId)?.name ?? String(item.userId),
      rate: item.rate,
      amount: item.amount,
      commissionAmount: item.amount,
      component: "organization_commission" as const,
    })),
  ];

  const allocatedAmount = entries.reduce((sum, item) => sum + item.amount, 0);
  if (allocatedAmount !== input.settlementAmount) {
    throw new Error("INTERNAL_SETTLEMENT_CONSERVATION_FAILED");
  }

  return {
    grossAmount: input.grossAmount,
    todoPayFee: input.todoPayFee,
    settlementAmount: input.settlementAmount,
    internalFeeAmount: directShares.reduce((sum, item) => sum + item.amount, 0),
    storeCommissionAmount: storeShare.amount,
    entries,
  };
}

export function reverseInternalSettlement(
  allocation: InternalSettlementAllocation,
): InternalSettlementAllocation {
  return {
    ...allocation,
    grossAmount: -allocation.grossAmount,
    todoPayFee: -allocation.todoPayFee,
    settlementAmount: -allocation.settlementAmount,
    internalFeeAmount: -allocation.internalFeeAmount,
    storeCommissionAmount: -allocation.storeCommissionAmount,
    entries: allocation.entries.map(entry => ({
      ...entry,
      amount: -entry.amount,
      commissionAmount: -entry.commissionAmount,
    })),
  };
}
