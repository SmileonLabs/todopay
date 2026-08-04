import type { Response } from "express";

export function legacyFinancialWritesEnabled(): boolean {
  return process.env.PAYMENT_INTEGRATION_ENABLED === "true";
}

export function requireLegacyFinancialWrites(res: Response): boolean {
  if (legacyFinancialWritesEnabled()) return true;
  res.status(503).json({
    error: "셀링크의 기존 금융 쓰기 기능은 비활성화되었습니다. TodoPay 원장을 이용해 주세요.",
    code: "LEGACY_FINANCIAL_WRITES_DISABLED",
  });
  return false;
}
