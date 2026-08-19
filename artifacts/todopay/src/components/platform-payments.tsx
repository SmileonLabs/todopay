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
export function Payments(props: {
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
