export function requireKrwAmount(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive KRW integer`);
  return value;
}

export function calculateWithdrawal(amount: number, fixedFee: number) {
  requireKrwAmount(amount);
  if (!Number.isSafeInteger(fixedFee) || fixedFee < 0) throw new Error("withdrawal fee must be a non-negative KRW integer");
  const payoutAmount = amount - fixedFee;
  if (payoutAmount <= 0) throw new Error("withdrawal amount must exceed fee");
  return { reservedAmount: amount, fee: fixedFee, payoutAmount };
}

export function percentToBasisPoints(rate: string | number): number {
  const normalized = String(rate).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("invalid fee rate");
  const [whole, fraction = ""] = normalized.split(".");
  const bps = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("fee rate outside range");
  return bps;
}

export function calculateUsageFee(amount: number, rate: string | number): number {
  requireKrwAmount(amount);
  return Math.floor((amount * percentToBasisPoints(rate) + 5_000) / 10_000);
}
