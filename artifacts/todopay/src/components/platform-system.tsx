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
export function System({ status }: { status: SystemStatus | null }) {
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
