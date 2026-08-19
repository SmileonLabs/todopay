export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  required: boolean;
};
export type ActivityItem = {
  trackingNumber: string;
  status?: string;
  eventType?: string;
  provider?: string;
  amount?: number;
  updatedAt?: string;
  processedAt?: string;
};
export type ApiTestResult = { status: number; body: string };
export type WebhookDelivery = {
  eventId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  responseStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};
export type WebhookDeliveries = {
  webhookUrl: string | null;
  secretVersion: number;
  items: WebhookDelivery[];
};
export type PartnerOverview = {
  merchant: {
    id: number;
    code: string;
    name: string;
    status: string;
    webhookUrl: string | null;
    allowedIps: string[];
    apiKeyPrefix: string | null;
    dailyWithdrawalLimit: number;
    integrationStage: string;
  };
  integration: {
    apiKeyIssued: boolean;
    allowedIpCount: number;
    webhookConfigured: boolean;
    externalApiReady: boolean;
    paymentProviderEnabled: boolean;
    oneWonVerificationEnabled: boolean;
    virtualAccountEnabled: boolean;
    payoutEnabled: boolean;
    checklist: ChecklistItem[];
    warnings: string[];
  };
  summary: {
    memberCount: number;
    transactionCount: number;
    withdrawalCount: number;
    activeVirtualAccounts: number;
    awaitingVerificationCount: number;
    issuedVirtualAccountCount: number;
    recentWebhookEvents: number;
    deliveredWebhookCount: number;
    failedWebhookCount: number;
    todayDepositAmount: number;
  };
  fees: {
    configured: boolean;
    depositFee: number | null;
    withdrawalFee: number | null;
    usageFeeRate: number | null;
  };
};
export type PartnerActivity = {
  webhookEvents: ActivityItem[];
  recentWithdrawals: ActivityItem[];
  recentTransactions: ActivityItem[];
};
