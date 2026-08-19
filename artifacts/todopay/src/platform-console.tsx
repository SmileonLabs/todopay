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
import { usePlatformConsole } from "@/hooks/use-platform-console";
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
} from "./platform-console-types";

import {
  Audit,
  Credentials,
  Dashboard,
  Filters,
  MerchantManager,
  Payments,
  System,
  Webhooks,
  Withdrawals,
} from "@/components/platform-console-sections";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
});
function PlatformConsole() {
  const {
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
  } = usePlatformConsole();
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
                    { credentials: "include" },
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

export default function PlatformConsoleApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PlatformConsole />
      </AuthProvider>
    </QueryClientProvider>
  );
}
