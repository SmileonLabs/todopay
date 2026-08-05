import crypto from "node:crypto";

const MAX_TRACK_ID_LENGTH = 50;

export function createPaymentIntentTrackId(input: {
  merchantId: number;
  merchantOrderId: string;
  attemptNumber: number;
}): string {
  if (!Number.isSafeInteger(input.merchantId) || input.merchantId <= 0) {
    throw new Error("merchantId must be a positive safe integer");
  }
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(input.merchantOrderId)) {
    throw new Error("merchantOrderId has unsupported characters");
  }
  if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber <= 0 || input.attemptNumber > 999_999) {
    throw new Error("attemptNumber must be between 1 and 999999");
  }

  const readableOrder = input.merchantOrderId.toUpperCase().replace(/[^A-Z0-9]/g, "") || "ORDER";
  const hash = crypto.createHash("sha256")
    .update(`${input.merchantId}:${input.merchantOrderId}:${input.attemptNumber}`)
    .digest("hex")
    .slice(0, 16);
  const prefix = `TP${input.merchantId}-`;
  const suffix = `-A${input.attemptNumber}-${hash}`;
  const readableLength = MAX_TRACK_ID_LENGTH - prefix.length - suffix.length;
  if (readableLength < 1) throw new Error("merchantId or attemptNumber is too long");
  return `${prefix}${readableOrder.slice(0, readableLength)}${suffix}`;
}

export type PaymentIntentDepositMappingInput = {
  status: string;
  expectedAmount: string;
  providerTrackingNumber: string | null;
  notificationTrackId: string;
  notificationAmount: string;
};

export type PaymentIntentDepositMappingResult =
  | { kind: "matched" }
  | { kind: "track_mismatch" }
  | { kind: "amount_mismatch" }
  | { kind: "not_payable" };

/** Pure validation only. It deliberately does not mutate a transaction, ledger, or PG state. */
export function mapKpPayDepositToPaymentIntent(
  input: PaymentIntentDepositMappingInput,
): PaymentIntentDepositMappingResult {
  if (input.status !== "awaiting_deposit") return { kind: "not_payable" };
  if (!input.providerTrackingNumber || input.providerTrackingNumber !== input.notificationTrackId) {
    return { kind: "track_mismatch" };
  }
  if (input.expectedAmount !== input.notificationAmount) return { kind: "amount_mismatch" };
  return { kind: "matched" };
}

