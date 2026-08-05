const attachedStates = new Set([
  "awaiting_deposit",
  "processing",
  "succeeded",
  "amount_mismatch",
  "reversed",
]);

/** True only when an attachment request is a safe replay of an established member binding. */
export function isPaymentIntentMemberReplay(
  status: string,
  currentMemberId: number | null,
  requestedMemberId: number,
): boolean {
  return currentMemberId === requestedMemberId && attachedStates.has(status);
}

