export type WithdrawalState = "unpaid" | "submitting" | "processing" | "paid" | "failed" | "unknown";

export function canApplyPayoutNotification(approvalStatus: string, current: WithdrawalState, next: WithdrawalState): boolean {
  if (approvalStatus !== "approved") return false;
  if (current === "submitting" || current === "processing") {
    return ["paid", "failed", "unknown"].includes(next);
  }
  // The provider guide allows a later bank failure after a completion result.
  return current === "paid" && ["failed", "unknown"].includes(next);
}

export function needsWithdrawalRefund(next: WithdrawalState): boolean {
  return next === "failed" || next === "unknown";
}
