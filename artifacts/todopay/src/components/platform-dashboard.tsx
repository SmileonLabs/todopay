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

import {
  DataTable,
  Empty,
  Field,
  Pager,
  StateBadge,
  dateTime,
  safeOperatorName,
  statusLabel,
  won,
} from "./platform-console-ui";
export function Dashboard({ overview }: { overview: Overview | null }) {
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
