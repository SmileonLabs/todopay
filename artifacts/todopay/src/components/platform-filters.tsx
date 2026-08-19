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
export function Filters({
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
