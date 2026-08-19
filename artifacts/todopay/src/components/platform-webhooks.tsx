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
import { Filters } from "./platform-filters";
export function Webhooks(props: {
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
