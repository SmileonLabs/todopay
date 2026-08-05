const EXPIRABLE_STATUSES = new Set(["requires_member", "awaiting_deposit"]);

export function isPaymentIntentExpirable(status: string, expiresAt: Date, now: Date): boolean {
  return EXPIRABLE_STATUSES.has(status) && expiresAt <= now;
}

export const paymentIntentExpirableStatuses = ["requires_member", "awaiting_deposit"] as const;

