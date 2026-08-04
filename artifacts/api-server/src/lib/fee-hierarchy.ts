export function percentToBasisPoints(rate: number): number {
  if (!Number.isFinite(rate)) throw new Error("INVALID_FEE_RATE");
  return Math.round(rate * 100);
}

export function basisPointsToPercent(basisPoints: number): number {
  return basisPoints / 100;
}

export function feeAmountAtRate(originalAmount: number, rate: number): number {
  return Math.round(originalAmount * percentToBasisPoints(rate) / 10_000);
}

export function calculateResidualRate(
  totalRate: number,
  allocatedRates: number[],
): { allocatedRate: number; residualRate: number } {
  const allocatedBasisPoints = allocatedRates
    .reduce((sum, rate) => sum + percentToBasisPoints(rate), 0);
  const totalBasisPoints = percentToBasisPoints(totalRate);
  if (allocatedBasisPoints > totalBasisPoints) {
    throw new Error("FEE_ALLOCATION_EXCEEDS_TOTAL");
  }
  return {
    allocatedRate: basisPointsToPercent(allocatedBasisPoints),
    residualRate: basisPointsToPercent(totalBasisPoints - allocatedBasisPoints),
  };
}

export function calculateDirectFeeShares(
  originalAmount: number,
  totalRate: number,
  storeId: number,
  organizationRates: Array<{ userId: number; rate: number }>,
): Array<{ userId: number; rate: number; amount: number }> {
  const { residualRate } = calculateResidualRate(
    totalRate,
    organizationRates.map(item => item.rate),
  );

  const nodes = [
    { userId: storeId, rate: residualRate },
    ...organizationRates,
  ];
  const totalAmount = feeAmountAtRate(originalAmount, totalRate);
  const exactAmounts = nodes.map(node =>
    originalAmount * percentToBasisPoints(node.rate) / 10_000);
  const amounts = exactAmounts.map(Math.floor);
  const remainder = totalAmount - amounts.reduce((sum, amount) => sum + amount, 0);

  const remainderOrder = exactAmounts
    .map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; index < remainder; index += 1) {
    amounts[remainderOrder[index % remainderOrder.length].index] += 1;
  }

  return nodes.map((node, index) => ({
    ...node,
    amount: amounts[index],
  }));
}
