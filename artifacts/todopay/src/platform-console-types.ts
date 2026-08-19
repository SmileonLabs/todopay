export type Section =
  | "dashboard"
  | "merchants"
  | "payments"
  | "withdrawals"
  | "webhooks"
  | "credentials"
  | "audit"
  | "system";
export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
export type FilterState = {
  merchantId: string;
  status: string;
  search: string;
  startDate: string;
  endDate: string;
};
export type Merchant = {
  id: number;
  code: string;
  name: string;
  status: string;
  adminDomain: string | null;
  webhookUrl: string | null;
  allowedIps: string[];
  dailyWithdrawalLimit: number;
  apiKeyPrefix: string | null;
};
export type MerchantDetail = {
  merchant: Merchant & {
    apiKeyIssued: boolean;
    createdAt: string;
    updatedAt: string;
  };
  summary: {
    members: number;
    payments: number;
    withdrawals: number;
    activeVirtualAccounts: number;
  };
  operators: Array<{
    id: number;
    loginId: string;
    name: string;
    isActive: boolean;
    useOtp: boolean;
    createdAt: string;
  }>;
  fees: {
    depositFee: number;
    withdrawalFee: number;
    usageFeeRate: number;
    effectiveFrom: string;
  } | null;
  integration: {
    apiKeyIssued: boolean;
    webhookConfigured: boolean;
    allowedIpCount: number;
    providerEnabled: boolean;
  };
};
export type Overview = {
  summary: {
    merchantCount: number;
    activeMerchantCount: number;
    paymentCount: number;
    paymentAmount: number;
    failedPaymentCount: number;
    pendingWithdrawalCount: number;
    webhookCount: number;
    webhookFailureCount: number;
  };
  alerts: Array<{ level: string; code: string; message: string }>;
};
export type Payment = {
  id: number;
  trackingNumber: string;
  pgTransactionId: string | null;
  status: string;
  paymentAmount: number;
  fee: number;
  settlementAmount: number;
  merchant: { id: number; code: string; name: string };
  member: { name: string | null; loginId: string | null };
  requestedAt: string;
  completedAt: string | null;
};
export type PaymentDetail = Payment & {
  providerEventId: string | null;
  fromAccount: string | null;
  toAccount: string | null;
  member:
    | (Payment["member"] & {
        id: number;
        phone: string | null;
        email: string | null;
      })
    | null;
  events: Array<{
    provider: string;
    eventType: string;
    eventId: string;
    processedAt: string;
  }>;
};
export type Withdrawal = {
  id: number;
  trackingNumber: string;
  amount: number;
  fee: number;
  totalAmount: number;
  approvalStatus: string;
  withdrawalStatus: string;
  accountNumber: string;
  accountBank: string;
  accountHolder: string;
  providerResultCode: string | null;
  providerResultMessage: string | null;
  merchantId: number;
  merchantCode: string;
  merchantName: string;
  createdAt: string;
};
export type WebhookEvent = {
  id: number;
  provider: string;
  eventId: string;
  eventType: string;
  trackingNumber: string;
  merchantId: number | null;
  merchantCode: string | null;
  merchantName: string | null;
  processedAt: string;
};
export type AuditLog = {
  id: number;
  actorLoginId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: number | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
};
export type SystemStatus = {
  checkedAt: string;
  api: string;
  database: string;
  cache: string;
  queue: { waiting: number; active: number; failed: number; delayed: number };
  providerEnabled: boolean;
  version: string;
};
export type RequestFn = <T>(path: string, init?: RequestInit) => Promise<T>;
export type RunFn = (work: () => Promise<void>) => Promise<void>;
