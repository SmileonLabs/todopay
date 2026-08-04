import type { AdminUser } from "@workspace/api-client-react";

export type Capability =
  | "financial.read"
  | "financial.manage"
  | "withdrawals.request"
  | "withdrawals.approve"
  | "members.read"
  | "members.manage"
  | "organizations.read"
  | "organizations.manage"
  | "fees.read"
  | "fees.manage"
  | "statistics.read"
  | "notices.read"
  | "notices.manage"
  | "otp.manage"
  | "profile.manage";

export function can(user: AdminUser | null, capability: Capability): boolean {
  return Boolean(user?.capabilities?.includes(capability));
}
export function hasFinancialScope(user: AdminUser | null): boolean {
  return Boolean(user?.financialScopeReady);
}
