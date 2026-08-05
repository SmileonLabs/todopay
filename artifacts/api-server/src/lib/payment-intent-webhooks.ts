export type PaymentIntentWebhookType =
  | "payment_intent.created"
  | "payment_intent.awaiting_deposit"
  | "payment_intent.cancelled"
  | "payment_intent.succeeded"
  | "payment_intent.amount_mismatch"
  | "payment_intent.expired"
  | "payment_intent.reversed";

export type PaymentIntentWebhookInput = {
  eventId: string;
  eventType: PaymentIntentWebhookType;
  paymentIntentId: string;
  merchantOrderId: string;
  externalCustomerId: string | null;
  memberId: number | null;
  amount: string;
  currency: "KRW";
  status: string;
  trackingNumber?: string | null;
  transactionId?: number | null;
  providerTransactionId?: string | null;
  receivedAmount?: string | null;
  occurredAt?: Date;
};

/** Stable merchant contract. Amount remains a decimal string across JSON boundaries. */
export function buildPaymentIntentWebhook(input: PaymentIntentWebhookInput) {
  if (!/^[1-9]\d*$/.test(input.amount)) {
    throw new Error("Payment intent webhook amount must be a positive integer string");
  }
  const createdAt = (input.occurredAt ?? new Date()).toISOString();
  return {
    id: input.eventId,
    type: input.eventType,
    createdAt,
    data: {
      paymentIntentId: input.paymentIntentId,
      merchantOrderId: input.merchantOrderId,
      externalCustomerId: input.externalCustomerId,
      memberId: input.memberId,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      trackingNumber: input.trackingNumber ?? null,
      transactionId: input.transactionId ?? null,
      providerTransactionId: input.providerTransactionId ?? null,
      receivedAmount: input.receivedAmount ?? null,
      occurredAt: createdAt,
    },
  };
}
