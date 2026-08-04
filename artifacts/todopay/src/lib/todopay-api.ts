import { useQuery } from "@tanstack/react-query";

export async function todoPayApi<T>(path: string): Promise<T> {
  const token = localStorage.getItem("todopay_token");
  const response = await fetch(`/api/todopay${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const payload = await response.json().catch(() => ({ error: "응답을 읽을 수 없습니다." }));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "TodoPay API 요청에 실패했습니다.");
  }
  return payload as T;
}

export function useTodoPayQuery<T>(
  path: string,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useQuery<T>({
    queryKey: ["todopay", path],
    queryFn: () => todoPayApi<T>(path),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime ?? 15_000,
    retry: false,
  });
}

export type IntegrationStatus = {
  configured: boolean;
  connected: boolean;
  message?: string;
  integration?: {
    merchantCode: string;
    merchantStatus: string;
    apiAuthenticated: boolean;
    allowedIpCount: number;
    webhookConfigured: boolean;
    paymentProviderEnabled: boolean;
    checkedAt: string;
  };
};

export type TodoPayOverview = {
  members: number;
  transactions: number;
  pendingWithdrawals: { count: number; amount: number };
  todayDeposits: number;
};

export type TodoPayBalance = {
  currency: "KRW";
  availableBalance: number;
  creditTotal: number;
  debitTotal: number;
  calculatedAt: string;
};

export type TodoPayFees = {
  configured: boolean;
  depositFee: number | null;
  withdrawalFee: number | null;
  usageFeeRate: number | null;
  effectiveFrom: string | null;
  updatedAt: string | null;
};

export type TodoPayMerchant = {
  id: number;
  code: string;
  name: string;
  status: string;
  webhookUrl: string | null;
  allowedIps: string[];
  dailyWithdrawalLimit: number;
};

export type Page<T> = { page: number; limit: number; total: number; items: T[] };

export type TodoPayTransaction = {
  id: number;
  trackingNumber: string;
  memberId?: number | null;
  type: string;
  originalAmount: number;
  amount: number;
  fee: number;
  status: string;
  fromAccount?: string;
  toAccount?: string;
  providerTransactionId: string;
  createdAt: string;
  processedAt: string | null;
  events?: Array<{ provider: string; eventId: string; eventType: string; processedAt: string }>;
};

export type TodoPayWithdrawal = {
  id: number;
  trackingNumber: string;
  memberId?: number | null;
  storeId?: number | null;
  amount: number;
  fee: number;
  payoutAmount: number;
  approvalStatus: string;
  payoutStatus: string;
  accountNumber?: string;
  accountBank?: string;
  accountHolder?: string;
  rejectReason?: string | null;
  providerTransactionId: string | null;
  providerResultCode?: string | null;
  providerResultMessage?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  paidAt?: string | null;
  providerUpdatedAt: string | null;
  events?: Array<{ provider: string; eventId: string; eventType: string; processedAt: string }>;
};

export type TodoPayMember = {
  id: number;
  loginId: string;
  name: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  isVerified: boolean;
  virtualAccount: { bankName: string; accountNumber: string; status: string } | null;
  createdAt: string;
};
