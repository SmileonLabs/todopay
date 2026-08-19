import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import type {
  AuditLog,
  FilterState,
  Merchant,
  MerchantDetail,
  Overview,
  Pagination,
  Payment,
  PaymentDetail,
  Section,
  SystemStatus,
  WebhookEvent,
  Withdrawal,
} from "../platform-console-types";

export function usePlatformConsole() {
  const { user, token, signOut, isLoading } = useAuth();
  const [section, setSection] = useState<Section>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantPagination, setMerchantPagination] = useState<Pagination>();
  const [merchantSearch, setMerchantSearch] = useState("");
  const [selectedMerchantId, setSelectedMerchantId] = useState<number | null>(
    null,
  );
  const [merchantDetail, setMerchantDetail] = useState<MerchantDetail | null>(
    null,
  );
  const [overview, setOverview] = useState<Overview | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentPagination, setPaymentPagination] = useState<Pagination>();
  const [paymentDetail, setPaymentDetail] = useState<PaymentDetail | null>(
    null,
  );
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [withdrawalPagination, setWithdrawalPagination] =
    useState<Pagination>();
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [webhookPagination, setWebhookPagination] = useState<Pagination>();
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditPagination, setAuditPagination] = useState<Pagination>();
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [filters, setFilters] = useState({
    merchantId: "",
    status: "",
    search: "",
    startDate: "",
    endDate: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const isPlatformOperator =
    user?.role === "platform_admin" || user?.role === "superadmin";

  const request = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        ...init,
        credentials: "include",
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `요청 실패 (${response.status})`);
      }
      return response.json() as Promise<T>;
    },
    [token],
  );

  const run = useCallback(async (work: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "요청을 처리하지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMerchants = useCallback(
    async (page = 1, search = merchantSearch) => {
      const query = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) query.set("search", search);
      const result = await request<{
        merchants: Merchant[];
        pagination: Pagination;
      }>(`/platform/merchants?${query}`);
      setMerchants(result.merchants);
      setMerchantPagination(result.pagination);
      if (!selectedMerchantId && result.merchants[0])
        setSelectedMerchantId(result.merchants[0].id);
    },
    [merchantSearch, request, selectedMerchantId],
  );

  const loadDetail = useCallback(
    async (merchantId: number) => {
      const result = await request<MerchantDetail>(
        `/platform/merchants/${merchantId}/detail`,
      );
      setMerchantDetail(result);
    },
    [request],
  );

  const buildFilter = useCallback(
    (page = 1) => {
      const query = new URLSearchParams({ page: String(page), limit: "20" });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });
      return query;
    },
    [filters],
  );

  const loadSection = useCallback(
    async (page = 1) => {
      if (!token || !isPlatformOperator) return;
      await run(async () => {
        if (section === "dashboard")
          setOverview(await request<Overview>("/platform/overview"));
        if (section === "merchants" || section === "credentials")
          await loadMerchants(page);
        if (section === "payments") {
          const result = await request<{
            items: Payment[];
            pagination: Pagination;
          }>(`/platform/payments?${buildFilter(page)}`);
          setPayments(result.items);
          setPaymentPagination(result.pagination);
        }
        if (section === "withdrawals") {
          const query = buildFilter(page);
          if (filters.status) {
            query.delete("status");
            query.set("approvalStatus", filters.status);
          }
          const result = await request<{
            items: Withdrawal[];
            pagination: Pagination;
          }>(`/platform/withdrawals?${query}`);
          setWithdrawals(result.items);
          setWithdrawalPagination(result.pagination);
        }
        if (section === "webhooks") {
          const query = buildFilter(page);
          query.delete("status");
          query.delete("startDate");
          query.delete("endDate");
          const result = await request<{
            items: WebhookEvent[];
            pagination: Pagination;
          }>(`/platform/webhooks?${query}`);
          setWebhooks(result.items);
          setWebhookPagination(result.pagination);
        }
        if (section === "audit") {
          const query = new URLSearchParams({
            page: String(page),
            limit: "20",
          });
          if (filters.search) query.set("action", filters.search);
          const result = await request<{
            items: AuditLog[];
            pagination: Pagination;
          }>(`/platform/audit-logs?${query}`);
          setAuditLogs(result.items);
          setAuditPagination(result.pagination);
        }
        if (section === "system")
          setSystem(await request<SystemStatus>("/platform/system-status"));
      });
    },
    [
      buildFilter,
      filters.search,
      filters.status,
      isPlatformOperator,
      loadMerchants,
      request,
      run,
      section,
      token,
    ],
  );

  useEffect(() => {
    void loadSection();
  }, [section, token, isPlatformOperator]);
  useEffect(() => {
    if (token && isPlatformOperator && merchants.length === 0)
      void run(() => loadMerchants());
  }, [token, isPlatformOperator]);
  useEffect(() => {
    if (selectedMerchantId && ["merchants", "credentials"].includes(section))
      void run(() => loadDetail(selectedMerchantId));
  }, [selectedMerchantId, section]);

  return {
    user,
    token,
    signOut,
    isLoading,
    section,
    setSection,
    mobileOpen,
    setMobileOpen,
    merchants,
    merchantPagination,
    merchantSearch,
    setMerchantSearch,
    selectedMerchantId,
    setSelectedMerchantId,
    merchantDetail,
    overview,
    payments,
    paymentPagination,
    paymentDetail,
    setPaymentDetail,
    withdrawals,
    withdrawalPagination,
    webhooks,
    webhookPagination,
    auditLogs,
    auditPagination,
    system,
    filters,
    setFilters,
    loading,
    error,
    setError,
    notice,
    setNotice,
    oneTimeKey,
    setOneTimeKey,
    isPlatformOperator,
    request,
    run,
    loadMerchants,
    loadDetail,
    buildFilter,
    loadSection,
  };
}
