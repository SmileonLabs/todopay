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

export const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
export const dateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString("ko-KR") : "-";
export const safeOperatorName = (value: string) =>
  /[?\uFFFD]/.test(value) ? "가맹점 운영자" : value;
export const statusLabel: Record<string, string> = {
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

export function StateBadge({ value }: { value: string }) {
  const good = ["active", "success", "approved", "paid", "ok"].includes(value);
  const bad = ["failed", "rejected", "terminated", "error"].includes(value);
  return (
    <Badge variant={bad ? "destructive" : good ? "default" : "secondary"}>
      {statusLabel[value] ?? value}
    </Badge>
  );
}

export function Empty({
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

export function Pager({
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

export function DataTable({
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

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
