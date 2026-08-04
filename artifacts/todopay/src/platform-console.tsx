import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Activity,
  BellRing,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Users,
  WalletCards,
  Webhook,
  X,
} from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import Login from "@/pages/login";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MfaEnrollmentCard } from "@/components/mfa-enrollment-card";

type Section =
  | "dashboard"
  | "merchants"
  | "payments"
  | "withdrawals"
  | "webhooks"
  | "credentials"
  | "audit"
  | "system";
type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
type FilterState = {
  merchantId: string;
  status: string;
  search: string;
  startDate: string;
  endDate: string;
};
type Merchant = {
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
type MerchantDetail = {
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
type Overview = {
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
type Payment = {
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
type PaymentDetail = Payment & {
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
type Withdrawal = {
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
type WebhookEvent = {
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
type AuditLog = {
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
type SystemStatus = {
  checkedAt: string;
  api: string;
  database: string;
  cache: string;
  queue: { waiting: number; active: number; failed: number; delayed: number };
  providerEnabled: boolean;
  version: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
});
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const dateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString("ko-KR") : "-";
const safeOperatorName = (value: string) =>
  /[?\uFFFD]/.test(value) ? "가맹점 운영자" : value;
const statusLabel: Record<string, string> = {
  active: "정상",
  pending: "대기",
  suspended: "중지",
  terminated: "종료",
  success: "성공",
  failed: "실패",
  received: "수신",
  processing: "처리 중",
  approved: "승인",
  rejected: "반려",
  unpaid: "미지급",
  paid: "지급 완료",
  unknown: "확인 필요",
  ok: "정상",
  error: "오류",
  not_configured: "미설정",
};

function StateBadge({ value }: { value: string }) {
  const good = ["active", "success", "approved", "paid", "ok"].includes(value);
  const bad = ["failed", "rejected", "terminated", "error"].includes(value);
  return (
    <Badge variant={bad ? "destructive" : good ? "default" : "secondary"}>
      {statusLabel[value] ?? value}
    </Badge>
  );
}

function Empty({
  children = "조회된 데이터가 없습니다.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Pager({
  value,
  onChange,
}: {
  value?: Pagination;
  onChange: (page: number) => void;
}) {
  if (!value || value.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-4 text-sm text-muted-foreground">
      <span>
        총 {value.total.toLocaleString()}건 · {value.page}/{value.totalPages}
      </span>
      <Button
        variant="outline"
        size="icon"
        disabled={value.page <= 1}
        onClick={() => onChange(value.page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        disabled={value.page >= value.totalPages}
        onClick={() => onChange(value.page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function DataTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th className="px-4 py-3 font-medium" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

function PlatformConsole() {
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
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
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

  const nav = useMemo(
    () => [
      {
        id: "dashboard" as const,
        label: "운영 대시보드",
        icon: LayoutDashboard,
      },
      { id: "merchants" as const, label: "가맹점 관리", icon: Building2 },
      {
        id: "payments" as const,
        label: "결제 통합 조회",
        icon: CircleDollarSign,
      },
      {
        id: "withdrawals" as const,
        label: "출금·정산 조회",
        icon: WalletCards,
      },
      { id: "webhooks" as const, label: "PG·Webhook", icon: Webhook },
      { id: "credentials" as const, label: "계정·API 키", icon: KeyRound },
      { id: "audit" as const, label: "감사 로그", icon: ClipboardList },
      { id: "system" as const, label: "시스템 상태", icon: ServerCog },
    ],
    [],
  );

  if (isLoading) return <div className="min-h-screen bg-background" />;
  if (!user) return <Login />;
  if (!isPlatformOperator)
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <ShieldAlert className="mb-2 h-8 w-8 text-destructive" />
            <CardTitle>플랫폼 접근 권한이 없습니다</CardTitle>
            <CardDescription>
              가맹점 관리자는 TodoPay 플랫폼 운영 콘솔을 사용할 수 없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={signOut}>로그아웃</Button>
          </CardContent>
        </Card>
      </div>
    );

  const openSection = (id: Section) => {
    setSection(id);
    setMobileOpen(false);
    setError(null);
    setNotice(null);
    setPaymentDetail(null);
  };
  const selectedMerchant = merchants.find(
    (merchant) => merchant.id === selectedMerchantId,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-sidebar transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-20 items-center gap-3 border-b px-6">
          <div>
            <BrandWordmark className="h-auto w-36" />
            <p className="text-xs text-muted-foreground">통합 운영 콘솔</p>
          </div>
          <Button
            className="ml-auto lg:hidden"
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => openSection(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${section === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"}`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t p-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="mb-3 text-xs text-muted-foreground">
            플랫폼 운영 관리자
          </p>
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={signOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            로그아웃
          </Button>
        </div>
      </aside>
      {mobileOpen && (
        <button
          aria-label="메뉴 닫기"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b bg-background/95 px-4 backdrop-blur lg:px-8">
          <Button
            className="mr-3 lg:hidden"
            variant="outline"
            size="icon"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div>
            <p className="text-sm font-semibold">
              {nav.find((item) => item.id === section)?.label}
            </p>
            <p className="text-xs text-muted-foreground">
              TodoPay 전체 가맹점 운영 범위
            </p>
          </div>
          <Button
            className="ml-auto"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadSection()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            새로고침
          </Button>
        </header>
        <main className="space-y-6 p-4 lg:p-8">
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm text-primary">
              {notice}
            </div>
          )}
          {section === "dashboard" && <Dashboard overview={overview} />}
          {section === "merchants" && (
            <MerchantManager
              merchants={merchants}
              pagination={merchantPagination}
              search={merchantSearch}
              setSearch={setMerchantSearch}
              selectedId={selectedMerchantId}
              select={setSelectedMerchantId}
              detail={merchantDetail}
              request={request}
              run={run}
              reload={async () => {
                await loadMerchants();
                if (selectedMerchantId) await loadDetail(selectedMerchantId);
              }}
              onPage={(page) => void run(() => loadMerchants(page))}
              notify={setNotice}
            />
          )}
          {section === "payments" && (
            <Payments
              items={payments}
              pagination={paymentPagination}
              detail={paymentDetail}
              merchants={merchants}
              filters={filters}
              setFilters={setFilters}
              search={() => void loadSection()}
              page={(value) => void loadSection(value)}
              select={(id) =>
                void run(async () =>
                  setPaymentDetail(
                    await request<PaymentDetail>(`/platform/payments/${id}`),
                  ),
                )
              }
              close={() => setPaymentDetail(null)}
              exportCsv={() =>
                void run(async () => {
                  const response = await fetch(
                    `/api/platform/payments/export.csv?${buildFilter(1)}`,
                    { headers: { Authorization: `Bearer ${token}` } },
                  );
                  if (!response.ok)
                    throw new Error("CSV를 내려받지 못했습니다.");
                  const url = URL.createObjectURL(await response.blob());
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `todopay-payments-${new Date().toISOString().slice(0, 10)}.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                  setNotice("결제 내역 CSV를 내려받았습니다.");
                })
              }
            />
          )}
          {section === "withdrawals" && (
            <Withdrawals
              items={withdrawals}
              pagination={withdrawalPagination}
              merchants={merchants}
              filters={filters}
              setFilters={setFilters}
              search={() => void loadSection()}
              page={(value) => void loadSection(value)}
            />
          )}
          {section === "webhooks" && (
            <Webhooks
              items={webhooks}
              pagination={webhookPagination}
              merchants={merchants}
              filters={filters}
              setFilters={setFilters}
              search={() => void loadSection()}
              page={(value) => void loadSection(value)}
            />
          )}
          {section === "credentials" && (
            <Credentials
              merchants={merchants}
              selected={selectedMerchant ?? null}
              selectedId={selectedMerchantId}
              select={setSelectedMerchantId}
              detail={merchantDetail}
              oneTimeKey={oneTimeKey}
              dismiss={() => setOneTimeKey(null)}
              run={run}
              request={request}
              reload={() =>
                selectedMerchantId
                  ? loadDetail(selectedMerchantId)
                  : Promise.resolve()
              }
              setKey={setOneTimeKey}
              notify={setNotice}
            />
          )}
          {section === "audit" && (
            <Audit
              items={auditLogs}
              pagination={auditPagination}
              filters={filters}
              setFilters={setFilters}
              search={() => void loadSection()}
              page={(value) => void loadSection(value)}
            />
          )}
          {section === "system" && <System status={system} />}
        </main>
      </div>
    </div>
  );
}

function Dashboard({ overview }: { overview: Overview | null }) {
  if (!overview) return <Empty>운영 현황을 불러오는 중입니다.</Empty>;
  const cards = [
    [
      "전체 가맹점",
      overview.summary.merchantCount.toLocaleString(),
      `${overview.summary.activeMerchantCount}개 정상 운영`,
      Building2,
    ],
    [
      "오늘 결제",
      overview.summary.paymentCount.toLocaleString(),
      won.format(overview.summary.paymentAmount),
      CircleDollarSign,
    ],
    [
      "실패 결제",
      overview.summary.failedPaymentCount.toLocaleString(),
      "오늘 기준",
      ShieldAlert,
    ],
    [
      "승인 대기 출금",
      overview.summary.pendingWithdrawalCount.toLocaleString(),
      "조회 전용",
      WalletCards,
    ],
    [
      "오늘 Webhook",
      overview.summary.webhookCount.toLocaleString(),
      `실패 ${overview.summary.webhookFailureCount}건`,
      Webhook,
    ],
  ] as const;
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">운영 현황</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          전체 가맹점의 핵심 지표와 주의 항목을 한곳에서 확인합니다.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value, sub, Icon]) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between text-muted-foreground">
                <span className="text-sm">{label}</span>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-2xl font-semibold">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary" />
            운영 알림
          </CardTitle>
          <CardDescription>확인이 필요한 항목만 표시합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.alerts.length ? (
            overview.alerts.map((alert) => (
              <div
                key={alert.code}
                className="flex items-center gap-3 rounded-lg border p-3 text-sm"
              >
                <StateBadge
                  value={alert.level === "warning" ? "failed" : "pending"}
                />
                <span>{alert.message}</span>
              </div>
            ))
          ) : (
            <Empty>현재 주의 알림이 없습니다.</Empty>
          )}
        </CardContent>
      </Card>
      <MfaEnrollmentCard />
    </>
  );
}

type RequestFn = <T>(path: string, init?: RequestInit) => Promise<T>;
type RunFn = (work: () => Promise<void>) => Promise<void>;

function MerchantManager(props: {
  merchants: Merchant[];
  pagination?: Pagination;
  search: string;
  setSearch: (value: string) => void;
  selectedId: number | null;
  select: (id: number) => void;
  detail: MerchantDetail | null;
  request: RequestFn;
  run: RunFn;
  reload: () => Promise<void>;
  onPage: (page: number) => void;
  notify: (value: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const emptyCreate = {
    code: "",
    name: "",
    operatorName: "",
    loginId: "",
    password: "",
    passwordConfirm: "",
  };
  const [create, setCreate] = useState(emptyCreate);
  const [edit, setEdit] = useState({
    name: "",
    status: "pending",
    webhookUrl: "",
    allowedIps: "",
    dailyWithdrawalLimit: "0",
    depositFee: "0",
    withdrawalFee: "0",
    usageFeeRate: "0",
  });
  useEffect(() => {
    if (!props.detail) return;
    const { merchant, fees } = props.detail;
    setEdit({
      name: merchant.name,
      status: merchant.status,
      webhookUrl: merchant.webhookUrl ?? "",
      allowedIps: merchant.allowedIps.join(", "),
      dailyWithdrawalLimit: String(merchant.dailyWithdrawalLimit),
      depositFee: String(fees?.depositFee ?? 0),
      withdrawalFee: String(fees?.withdrawalFee ?? 0),
      usageFeeRate: String(fees?.usageFeeRate ?? 0),
    });
  }, [props.detail]);
  const save = () =>
    props.run(async () => {
      if (!props.selectedId) return;
      await props.request(`/platform/merchants/${props.selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: edit.name,
          status: edit.status,
          webhookUrl: edit.webhookUrl,
          allowedIps: edit.allowedIps
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          dailyWithdrawalLimit: Number(edit.dailyWithdrawalLimit),
        }),
      });
      await props.request(`/platform/merchants/${props.selectedId}/fees`, {
        method: "PUT",
        body: JSON.stringify({
          depositFee: Number(edit.depositFee),
          withdrawalFee: Number(edit.withdrawalFee),
          usageFeeRate: Number(edit.usageFeeRate),
        }),
      });
      await props.reload();
      props.notify("가맹점 운영 설정과 수수료 정책을 저장했습니다.");
    });
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">가맹점 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            TodoPay 계약, 연동, 수수료 정책을 가맹점 단위로 관리합니다.
          </p>
        </div>
        <Button onClick={() => setCreateOpen((value) => !value)}>
          <Plus className="mr-2 h-4 w-4" />
          가맹점 등록
        </Button>
      </div>
      {createOpen && (
        <Card>
          <CardHeader>
            <CardTitle>새 가맹점 등록</CardTitle>
            <CardDescription>
              가맹점과 최초 파트너 관리자 계정을 함께 생성합니다. 등록 후
              운영 설정을 완료하고 가맹점을 활성화하세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (create.password !== create.passwordConfirm) {
                  props.notify("초기 비밀번호와 비밀번호 확인이 일치하지 않습니다.");
                  return;
                }
                void props.run(async () => {
                  await props.request("/platform/merchants", {
                    method: "POST",
                    body: JSON.stringify({
                      code: create.code,
                      name: create.name,
                      partnerOperator: {
                        name: create.operatorName,
                        loginId: create.loginId,
                        password: create.password,
                      },
                    }),
                  });
                  setCreate(emptyCreate);
                  setCreateOpen(false);
                  await props.reload();
                  props.notify(
                    "가맹점과 파트너 관리자 계정을 등록했습니다. 운영 설정 후 가맹점을 활성화하세요.",
                  );
                });
              }}
            >
              <Field label="가맹점 코드">
                <Input
                  value={create.code}
                  onChange={(e) =>
                    setCreate({ ...create, code: e.target.value.toUpperCase() })
                  }
                  placeholder="MERCHANT_001"
                  required
                />
              </Field>
              <Field label="가맹점명">
                <Input
                  value={create.name}
                  onChange={(e) =>
                    setCreate({ ...create, name: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="관리자 담당자명">
                <Input
                  value={create.operatorName}
                  onChange={(e) =>
                    setCreate({ ...create, operatorName: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="로그인 ID">
                <Input
                  value={create.loginId}
                  onChange={(e) =>
                    setCreate({ ...create, loginId: e.target.value })
                  }
                  minLength={3}
                  maxLength={50}
                  pattern="[A-Za-z0-9_.-]+"
                  title="영문, 숫자, 밑줄, 마침표, 하이픈만 사용할 수 있습니다."
                  autoComplete="off"
                  required
                />
              </Field>
              <Field label="초기 비밀번호">
                <Input
                  type="password"
                  value={create.password}
                  onChange={(e) =>
                    setCreate({ ...create, password: e.target.value })
                  }
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field label="초기 비밀번호 확인">
                <Input
                  type="password"
                  value={create.passwordConfirm}
                  onChange={(e) =>
                    setCreate({ ...create, passwordConfirm: e.target.value })
                  }
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <div className="flex items-end md:col-span-2 xl:col-span-3">
                <Button className="w-full">가맹점 및 관리자 등록</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>가맹점 목록</CardTitle>
            <CardDescription>검색 후 항목을 선택하세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={props.search}
                onChange={(e) => props.setSearch(e.target.value)}
                placeholder="코드 또는 가맹점명"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void props.run(() => props.reload());
                }}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => void props.run(() => props.reload())}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
            {props.merchants.length ? (
              props.merchants.map((merchant) => (
                <button
                  key={merchant.id}
                  onClick={() => props.select(merchant.id)}
                  className={`w-full rounded-lg border p-3 text-left ${props.selectedId === merchant.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{merchant.name}</p>
                    <StateBadge value={merchant.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {merchant.code}
                  </p>
                </button>
              ))
            ) : (
              <Empty />
            )}
            <Pager value={props.pagination} onChange={props.onPage} />
          </CardContent>
        </Card>
        {props.detail ? (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["회원", props.detail.summary.members],
                ["결제", props.detail.summary.payments],
                ["출금", props.detail.summary.withdrawals],
                ["활성 가상계좌", props.detail.summary.activeVirtualAccounts],
              ].map(([label, value]) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold">
                      {Number(value).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{props.detail.merchant.name} 운영 설정</CardTitle>
                <CardDescription>
                  API 요청 IP는 쉼표로 구분하며 Webhook URL은 HTTPS만
                  허용합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="가맹점명">
                  <Input
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </Field>
                <Field label="상태">
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={edit.status}
                    onChange={(e) =>
                      setEdit({ ...edit, status: e.target.value })
                    }
                  >
                    {["pending", "active", "suspended", "terminated"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {statusLabel[value]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="일 출금 한도">
                  <Input
                    type="number"
                    min="0"
                    value={edit.dailyWithdrawalLimit}
                    onChange={(e) =>
                      setEdit({ ...edit, dailyWithdrawalLimit: e.target.value })
                    }
                  />
                </Field>
                <Field label="Webhook URL">
                  <Input
                    value={edit.webhookUrl}
                    onChange={(e) =>
                      setEdit({ ...edit, webhookUrl: e.target.value })
                    }
                    placeholder="https://..."
                  />
                </Field>
                <Field label="API 허용 IP">
                  <Input
                    value={edit.allowedIps}
                    onChange={(e) =>
                      setEdit({ ...edit, allowedIps: e.target.value })
                    }
                    placeholder="203.0.113.10/32"
                  />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>TodoPay 계약 수수료</CardTitle>
                <CardDescription>
                  가맹점 내부 조직 수수료와 분리된 플랫폼 계약 기준입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <Field label="입금 건당 수수료">
                  <Input
                    type="number"
                    min="0"
                    value={edit.depositFee}
                    onChange={(e) =>
                      setEdit({ ...edit, depositFee: e.target.value })
                    }
                  />
                </Field>
                <Field label="출금 건당 수수료">
                  <Input
                    type="number"
                    min="0"
                    value={edit.withdrawalFee}
                    onChange={(e) =>
                      setEdit({ ...edit, withdrawalFee: e.target.value })
                    }
                  />
                </Field>
                <Field label="서비스 이용률 (%)">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={edit.usageFeeRate}
                    onChange={(e) =>
                      setEdit({ ...edit, usageFeeRate: e.target.value })
                    }
                  />
                </Field>
                <div className="sm:col-span-3 flex justify-end">
                  <Button onClick={save}>
                    <Save className="mr-2 h-4 w-4" />
                    전체 설정 저장
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Empty>가맹점을 선택하면 상세 설정이 표시됩니다.</Empty>
        )}
      </div>
    </>
  );
}

function Filters({
  merchants,
  filters,
  setFilters,
  onSearch,
  statusOptions,
}: {
  merchants?: Merchant[];
  filters: FilterState;
  setFilters: (value: FilterState) => void;
  onSearch: () => void;
  statusOptions?: string[];
}) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 md:grid-cols-6">
        {merchants && (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filters.merchantId}
            onChange={(e) =>
              setFilters({ ...filters, merchantId: e.target.value })
            }
          >
            <option value="">전체 가맹점</option>
            {merchants.map((merchant) => (
              <option key={merchant.id} value={merchant.id}>
                {merchant.name}
              </option>
            ))}
          </select>
        )}
        {statusOptions && (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">전체 상태</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {statusLabel[value] ?? value}
              </option>
            ))}
          </select>
        )}
        <Input
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="번호·회원·이벤트 검색"
        />
        <Input
          type="date"
          value={filters.startDate}
          onChange={(e) =>
            setFilters({ ...filters, startDate: e.target.value })
          }
        />
        <Input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
        />
        <Button onClick={onSearch}>
          <Search className="mr-2 h-4 w-4" />
          조회
        </Button>
      </CardContent>
    </Card>
  );
}

function Payments(props: {
  items: Payment[];
  pagination?: Pagination;
  detail: PaymentDetail | null;
  merchants: Merchant[];
  filters: FilterState;
  setFilters: (value: FilterState) => void;
  search: () => void;
  page: (value: number) => void;
  select: (id: number) => void;
  close: () => void;
  exportCsv: () => void;
}) {
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">결제 통합 조회</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            모든 가맹점의 결제 요청과 PG 처리 흐름을 조회합니다.
          </p>
        </div>
        <Button variant="outline" onClick={props.exportCsv}>
          <Download className="mr-2 h-4 w-4" />
          CSV 내보내기
        </Button>
      </div>
      <Filters
        merchants={props.merchants}
        filters={props.filters}
        setFilters={props.setFilters}
        onSearch={props.search}
        statusOptions={[
          "received",
          "processing",
          "pending",
          "success",
          "failed",
        ]}
      />
      {props.items.length ? (
        <Card>
          <CardContent className="p-0">
            <DataTable
              headers={[
                "요청일시",
                "가맹점",
                "결제번호",
                "회원",
                "결제금액",
                "수수료",
                "상태",
              ]}
            >
              {props.items.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => props.select(item.id)}
                >
                  <td className="px-4 py-3">{dateTime(item.requestedAt)}</td>
                  <td className="px-4 py-3">
                    {item.merchant.name}
                    <p className="text-xs text-muted-foreground">
                      {item.merchant.code}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.trackingNumber}
                  </td>
                  <td className="px-4 py-3">
                    {item.member.name ?? "-"}
                    <p className="text-xs text-muted-foreground">
                      {item.member.loginId}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {won.format(item.paymentAmount)}
                  </td>
                  <td className="px-4 py-3">{won.format(item.fee)}</td>
                  <td className="px-4 py-3">
                    <StateBadge value={item.status} />
                  </td>
                </tr>
              ))}
            </DataTable>
            <div className="px-4 pb-4">
              <Pager value={props.pagination} onChange={props.page} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Empty />
      )}
      {props.detail && (
        <div
          className="fixed inset-0 z-50 bg-black/70 p-4"
          onClick={props.close}
        >
          <Card
            className="ml-auto h-full max-w-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>결제 상세</CardTitle>
                <CardDescription>{props.detail.trackingNumber}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={props.close}>
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  [
                    "상태",
                    statusLabel[props.detail.status] ?? props.detail.status,
                  ],
                  ["가맹점", props.detail.merchant.name],
                  ["결제금액", won.format(props.detail.paymentAmount)],
                  ["정산금액", won.format(props.detail.settlementAmount)],
                  ["입금계좌", props.detail.fromAccount ?? "-"],
                  ["수취계좌", props.detail.toAccount ?? "-"],
                  ["PG 거래번호", props.detail.pgTransactionId ?? "-"],
                  ["요청일시", dateTime(props.detail.requestedAt)],
                ].map(([key, value]) => (
                  <div className="rounded-lg border p-3" key={key}>
                    <p className="text-xs text-muted-foreground">{key}</p>
                    <p className="mt-1 break-all text-sm">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="mb-2 font-medium">PG 이벤트</h3>
                {props.detail.events.length ? (
                  props.detail.events.map((event) => (
                    <div
                      className="mb-2 rounded-lg border p-3 text-sm"
                      key={`${event.eventId}-${event.processedAt}`}
                    >
                      <div className="flex justify-between">
                        <span>{event.eventType}</span>
                        <span className="text-muted-foreground">
                          {dateTime(event.processedAt)}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {event.provider} · {event.eventId}
                      </p>
                    </div>
                  ))
                ) : (
                  <Empty>연결된 PG 이벤트가 없습니다.</Empty>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function Withdrawals(props: {
  items: Withdrawal[];
  pagination?: Pagination;
  merchants: Merchant[];
  filters: FilterState;
  setFilters: (value: FilterState) => void;
  search: () => void;
  page: (value: number) => void;
}) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">출금·정산 조회</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          송금 실행 기능 없이 요청 상태와 결과만 안전하게 조회합니다.
        </p>
      </div>
      <Filters
        merchants={props.merchants}
        filters={props.filters}
        setFilters={props.setFilters}
        onSearch={props.search}
        statusOptions={["pending", "approved", "rejected"]}
      />
      {props.items.length ? (
        <Card>
          <CardContent className="p-0">
            <DataTable
              headers={[
                "요청일시",
                "가맹점",
                "출금번호",
                "계좌",
                "출금액",
                "승인",
                "지급",
              ]}
            >
              {props.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{dateTime(item.createdAt)}</td>
                  <td className="px-4 py-3">
                    {item.merchantName}
                    <p className="text-xs text-muted-foreground">
                      {item.merchantCode}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.trackingNumber}
                  </td>
                  <td className="px-4 py-3">
                    {item.accountBank} {item.accountNumber}
                    <p className="text-xs text-muted-foreground">
                      {item.accountHolder}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {won.format(item.amount)}
                    <p className="text-xs text-muted-foreground">
                      수수료 {won.format(item.fee)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge value={item.approvalStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge value={item.withdrawalStatus} />
                  </td>
                </tr>
              ))}
            </DataTable>
            <div className="px-4 pb-4">
              <Pager value={props.pagination} onChange={props.page} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Empty />
      )}
    </>
  );
}

function Webhooks(props: {
  items: WebhookEvent[];
  pagination?: Pagination;
  merchants: Merchant[];
  filters: FilterState;
  setFilters: (value: FilterState) => void;
  search: () => void;
  page: (value: number) => void;
}) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">PG·Webhook 이벤트</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          중복 방지 키와 처리 이력을 중심으로 수신 결과를 확인합니다.
        </p>
      </div>
      <Filters
        merchants={props.merchants}
        filters={props.filters}
        setFilters={props.setFilters}
        onSearch={props.search}
      />
      {props.items.length ? (
        <Card>
          <CardContent className="p-0">
            <DataTable
              headers={[
                "처리일시",
                "가맹점",
                "공급사",
                "이벤트 유형",
                "이벤트 ID",
                "결제번호",
              ]}
            >
              {props.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{dateTime(item.processedAt)}</td>
                  <td className="px-4 py-3">
                    {item.merchantName ?? "매핑 전"}
                    <p className="text-xs text-muted-foreground">
                      {item.merchantCode}
                    </p>
                  </td>
                  <td className="px-4 py-3">{item.provider}</td>
                  <td className="px-4 py-3">{item.eventType}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.eventId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.trackingNumber}
                  </td>
                </tr>
              ))}
            </DataTable>
            <div className="px-4 pb-4">
              <Pager value={props.pagination} onChange={props.page} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Empty />
      )}
    </>
  );
}

function Credentials(props: {
  merchants: Merchant[];
  selected: Merchant | null;
  selectedId: number | null;
  select: (id: number) => void;
  detail: MerchantDetail | null;
  oneTimeKey: string | null;
  dismiss: () => void;
  run: RunFn;
  request: RequestFn;
  reload: () => Promise<void>;
  setKey: (value: string | null) => void;
  notify: (value: string) => void;
}) {
  const [operator, setOperator] = useState({
    loginId: "",
    name: "",
    password: "",
  });
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">계정·API 자격증명</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          가맹점 운영자와 API 키의 발급·정지 이력을 분리 관리합니다.
        </p>
      </div>
      <select
        className="h-10 min-w-72 rounded-md border bg-background px-3 text-sm"
        value={props.selectedId ?? ""}
        onChange={(e) => props.select(Number(e.target.value))}
      >
        <option value="">가맹점 선택</option>
        {props.merchants.map((merchant) => (
          <option key={merchant.id} value={merchant.id}>
            {merchant.name} ({merchant.code})
          </option>
        ))}
      </select>
      {props.oneTimeKey && (
        <Card className="border-amber-500">
          <CardHeader>
            <CardTitle>새 API 키 — 1회 표시</CardTitle>
            <CardDescription>
              지금 안전한 비밀 저장소에 보관하세요. 화면을 닫으면 다시 확인할 수
              없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-lg bg-muted p-4 text-sm">
              {props.oneTimeKey}
            </code>
            <Button className="mt-3" variant="outline" onClick={props.dismiss}>
              확인 후 닫기
            </Button>
          </CardContent>
        </Card>
      )}
      {props.selected && props.detail ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>API 키</CardTitle>
              <CardDescription>
                현재 접두사: {props.selected.apiKeyPrefix ?? "발급되지 않음"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <StateBadge
                  value={
                    props.detail.integration.apiKeyIssued ? "active" : "pending"
                  }
                />
                <span className="text-sm">
                  허용 IP {props.detail.integration.allowedIpCount}개 · Webhook{" "}
                  {props.detail.integration.webhookConfigured
                    ? "설정됨"
                    : "미설정"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (
                      !confirm(
                        "기존 키는 즉시 사용할 수 없게 됩니다. 새 키를 발급할까요?",
                      )
                    )
                      return;
                    void props.run(async () => {
                      const result = await props.request<{ apiKey: string }>(
                        `/platform/merchants/${props.selected!.id}/api-key`,
                        { method: "POST" },
                      );
                      props.setKey(result.apiKey);
                      await props.reload();
                    });
                  }}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  발급·교체
                </Button>
                <Button
                  variant="destructive"
                  disabled={!props.detail.integration.apiKeyIssued}
                  onClick={() => {
                    if (
                      !confirm(
                        "API 키를 폐기하면 가맹점 API 호출이 즉시 중단됩니다. 계속할까요?",
                      )
                    )
                      return;
                    void props.run(async () => {
                      await props.request(
                        `/platform/merchants/${props.selected!.id}/api-key`,
                        { method: "DELETE" },
                      );
                      await props.reload();
                      props.notify("API 키를 폐기했습니다.");
                    });
                  }}
                >
                  키 폐기
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>파트너 운영자 추가·변경</CardTitle>
              <CardDescription>
                비밀번호는 12자 이상으로 설정하며 원문은 저장하지 않습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void props.run(async () => {
                    await props.request(
                      `/platform/merchants/${props.selected!.id}/partner-operator`,
                      { method: "PUT", body: JSON.stringify(operator) },
                    );
                    setOperator({ loginId: "", name: "", password: "" });
                    await props.reload();
                    props.notify("파트너 운영자를 등록했습니다.");
                  });
                }}
              >
                <Field label="로그인 ID">
                  <Input
                    value={operator.loginId}
                    onChange={(e) =>
                      setOperator({ ...operator, loginId: e.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="담당자명">
                  <Input
                    value={operator.name}
                    onChange={(e) =>
                      setOperator({ ...operator, name: e.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="초기 비밀번호">
                  <Input
                    type="password"
                    minLength={12}
                    value={operator.password}
                    onChange={(e) =>
                      setOperator({ ...operator, password: e.target.value })
                    }
                    required
                  />
                </Field>
                <Button className="w-full">
                  <Users className="mr-2 h-4 w-4" />
                  운영자 등록
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>등록 운영자</CardTitle>
            </CardHeader>
            <CardContent>
              {props.detail.operators.length ? (
                <DataTable
                  headers={[
                    "등록일",
                    "이름",
                    "로그인 ID",
                    "상태",
                    "OTP",
                    "관리",
                  ]}
                >
                  {props.detail.operators.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">{dateTime(item.createdAt)}</td>
                    <td className="px-4 py-3">{safeOperatorName(item.name)}</td>
                      <td className="px-4 py-3">{item.loginId}</td>
                      <td className="px-4 py-3">
                        <StateBadge
                          value={item.isActive ? "active" : "suspended"}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {item.useOtp ? "사용" : "미사용"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void props.run(async () => {
                                await props.request(
                                  `/platform/partner-operators/${item.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      isActive: !item.isActive,
                                    }),
                                  },
                                );
                                await props.reload();
                              })
                            }
                          >
                            {item.isActive ? "정지" : "활성"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void props.run(async () => {
                                await props.request(
                                  `/platform/partner-operators/${item.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      useOtp: !item.useOtp,
                                    }),
                                  },
                                );
                                await props.reload();
                              })
                            }
                          >
                            OTP {item.useOtp ? "해제" : "적용"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const password = prompt(
                                "12자 이상의 새 비밀번호를 입력하세요.",
                              );
                              if (!password) return;
                              void props.run(async () => {
                                await props.request(
                                  `/platform/partner-operators/${item.id}/reset-password`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({ password }),
                                  },
                                );
                                props.notify(
                                  "운영자 비밀번호를 재설정했습니다.",
                                );
                              });
                            }}
                          >
                            비밀번호 재설정
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Empty>가맹점을 선택하세요.</Empty>
      )}
    </>
  );
}

function Audit(props: {
  items: AuditLog[];
  pagination?: Pagination;
  filters: FilterState;
  setFilters: (value: FilterState) => void;
  search: () => void;
  page: (value: number) => void;
}) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">감사 로그</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          민감 설정 조회·변경과 자격증명 작업의 추적 기록입니다.
        </p>
      </div>
      <Card>
        <CardContent className="flex gap-2 p-4">
          <Input
            value={props.filters.search}
            onChange={(e) =>
              props.setFilters({ ...props.filters, search: e.target.value })
            }
            placeholder="작업명 검색 (예: merchant.api_key)"
          />
          <Button onClick={props.search}>
            <Search className="mr-2 h-4 w-4" />
            조회
          </Button>
        </CardContent>
      </Card>
      {props.items.length ? (
        <Card>
          <CardContent className="p-0">
            <DataTable headers={["일시", "운영자", "작업", "대상", "접속 IP"]}>
              {props.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{dateTime(item.createdAt)}</td>
                  <td className="px-4 py-3">
                    {item.actorLoginId ?? item.actorType}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{item.action}</td>
                  <td className="px-4 py-3">
                    {item.resourceType} #{item.resourceId ?? "-"}
                  </td>
                  <td className="px-4 py-3">{item.ipAddress ?? "-"}</td>
                </tr>
              ))}
            </DataTable>
            <div className="px-4 pb-4">
              <Pager value={props.pagination} onChange={props.page} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Empty />
      )}
    </>
  );
}

function System({ status }: { status: SystemStatus | null }) {
  if (!status) return <Empty>시스템 상태를 확인하는 중입니다.</Empty>;
  const services = [
    ["API", status.api],
    ["데이터베이스", status.database],
    ["Redis 캐시", status.cache],
    ["PG 실연동", status.providerEnabled ? "active" : "not_configured"],
  ] as const;
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">시스템 상태</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          API, 데이터 저장소, 큐와 외부 연동 활성 여부를 점검합니다.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {services.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 font-medium">
                  {statusLabel[value] ?? value}
                </p>
              </div>
              {["ok", "active"].includes(value) ? (
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              ) : (
                <Activity className="h-6 w-6 text-amber-400" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>결제 처리 큐</CardTitle>
          <CardDescription>
            확인 시각 {dateTime(status.checkedAt)} · 버전 {status.version}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          {Object.entries(status.queue).map(([key, value]) => (
            <div className="rounded-lg border p-4" key={key}>
              <p className="text-xs uppercase text-muted-foreground">{key}</p>
              <p className="mt-1 text-2xl font-semibold">
                {value.toLocaleString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export default function PlatformConsoleApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PlatformConsole />
      </AuthProvider>
    </QueryClientProvider>
  );
}
