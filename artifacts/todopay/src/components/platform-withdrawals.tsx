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
export function Withdrawals(props: {
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
