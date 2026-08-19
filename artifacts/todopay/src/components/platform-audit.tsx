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
export function Audit(props: {
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
