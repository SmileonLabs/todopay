import type { FinancialScope } from "./financial-scope.js";

export function normalizeStoreCodes(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
}

export function appendFinancialScope(path: string, scope: FinancialScope): string {
  if (scope.unrestricted) return path;
  if (scope.storeCodes.length === 0) throw new Error("FINANCIAL_SCOPE_NOT_CONFIGURED");
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}storeCodes=${encodeURIComponent(scope.storeCodes.join(","))}`;
}
