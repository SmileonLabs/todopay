import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader2,
  Search,
} from "lucide-react";
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

type PartnerRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type PaymentListItem = {
  id: number;
  trackingNumber: string;
  pgTransactionId: string;
  status: string;
  paymentAmount: number;
  fee: number;
  settlementAmount: number;
  fromAccount: string | null;
  toAccount: string | null;
  member: { id: number; loginId: string | null; name: string | null } | null;
  requestedAt: string;
  completedAt: string | null;
};

type PaymentListResponse = {
  items: PaymentListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type PaymentDetail = Omit<PaymentListItem, "member"> & {
  providerEventId: string | null;
  member: {
    id: number;
    loginId: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  virtualAccount: {
    bankName: string;
    accountNumber: string | null;
    status: string;
    createdAt: string;
  } | null;
  events: Array<{
    provider: string;
    eventType: string;
    eventId: string;
    processedAt: string;
  }>;
};

const STATUS_LABELS: Record<string, string> = {
  received: "접수",
  processing: "처리 중",
  pending: "입금 대기",
  success: "결제 완료",
  failed: "실패",
};

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") return "default";
  if (status === "failed") return "destructive";
  if (status === "processing" || status === "pending") return "secondary";
  return "outline";
}

function formatMoney(value: number) {
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

function dateInput(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function PartnerPayments({
  active,
  request,
}: {
  active: boolean;
  request: PartnerRequest;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState(() => dateInput(30));
  const [endDate, setEndDate] = useState(() => dateInput());
  const [data, setData] = useState<PaymentListResponse | null>(null);
  const [selected, setSelected] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPayments = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(status ? { status } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        });
        const result = await request<PaymentListResponse>(
          `/partner/payments?${params.toString()}`,
        );
        setData(result);
        setSelected(null);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "결제 내역을 불러오지 못했습니다.",
        );
      } finally {
        setLoading(false);
      }
    },
    [endDate, request, search, startDate, status],
  );

  useEffect(() => {
    if (active && !data) void loadPayments(1);
  }, [active, data, loadPayments]);

  const loadDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const result = await request<PaymentDetail>(`/partner/payments/${id}`);
      setSelected(result);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "결제 상세 정보를 불러오지 못했습니다.",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">결제 내역</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          가맹점 고객의 결제 처리 결과와 PG 이벤트를 조회합니다. 개인정보는
          마스킹되어 표시됩니다.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">검색 조건</CardTitle>
          <CardDescription>
            최근 30일 기준으로 조회하며 기간과 상태를 변경할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_160px_160px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void loadPayments(1);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="payment-search">결제번호·PG번호·회원</Label>
              <Input
                id="payment-search"
                value={search}
                maxLength={100}
                placeholder="검색어 입력"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-status">상태</Label>
              <select
                id="payment-status"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">전체</option>
                <option value="received">접수</option>
                <option value="processing">처리 중</option>
                <option value="pending">입금 대기</option>
                <option value="success">결제 완료</option>
                <option value="failed">실패</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-start-date">시작일</Label>
              <Input
                id="payment-start-date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-end-date">종료일</Label>
              <Input
                id="payment-end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <Button type="submit" className="self-end" disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              조회
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">결제 목록</CardTitle>
            <CardDescription>
              총 {data?.pagination.total.toLocaleString("ko-KR") ?? 0}건
            </CardDescription>
          </div>
          {loading && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted/70 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">결제번호</th>
                  <th className="p-3">회원</th>
                  <th className="p-3">상태</th>
                  <th className="p-3 text-right">결제 금액</th>
                  <th className="p-3 text-right">수수료</th>
                  <th className="p-3 text-right">정산 금액</th>
                  <th className="p-3">요청 일시</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.length ? (
                  data.items.map((payment) => (
                    <tr
                      key={payment.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
                      onClick={() => void loadDetail(payment.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          void loadDetail(payment.id);
                      }}
                    >
                      <td className="p-3">
                        <p className="font-medium">{payment.trackingNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {payment.pgTransactionId}
                        </p>
                      </td>
                      <td className="p-3">
                        <p>{payment.member?.name ?? "비회원"}</p>
                        <p className="text-xs text-muted-foreground">
                          {payment.member?.loginId ?? "-"}
                        </p>
                      </td>
                      <td className="p-3">
                        <Badge variant={statusVariant(payment.status)}>
                          {STATUS_LABELS[payment.status] ?? payment.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-medium">
                        {formatMoney(payment.paymentAmount)}
                      </td>
                      <td className="p-3 text-right">
                        {formatMoney(payment.fee)}
                      </td>
                      <td className="p-3 text-right">
                        {formatMoney(payment.settlementAmount)}
                      </td>
                      <td className="p-3">{formatDate(payment.requestedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="p-10 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      {loading
                        ? "결제 내역을 불러오는 중입니다."
                        : "조건에 맞는 결제 내역이 없습니다."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data?.pagination.page ?? 1} / {data?.pagination.totalPages ?? 1}{" "}
              페이지
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || !data || data.pagination.page <= 1}
                onClick={() =>
                  void loadPayments((data?.pagination.page ?? 1) - 1)
                }
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                이전
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  loading ||
                  !data ||
                  data.pagination.page >= data.pagination.totalPages
                }
                onClick={() =>
                  void loadPayments((data?.pagination.page ?? 1) + 1)
                }
              >
                다음
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {(selected || detailLoading) && (
        <Card className="border-cyan-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-cyan-400" />
              결제 상세 현황
            </CardTitle>
            <CardDescription>
              상세 조회 기록은 보안 감사 로그에 저장됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detailLoading && !selected ? (
              <div className="flex justify-center p-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : selected ? (
              <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Detail
                    label="TodoPay 결제번호"
                    value={selected.trackingNumber}
                  />
                  <Detail
                    label="PG 거래번호"
                    value={selected.pgTransactionId}
                  />
                  <Detail
                    label="처리 상태"
                    value={STATUS_LABELS[selected.status] ?? selected.status}
                  />
                  <Detail
                    label="결제 요청"
                    value={formatDate(selected.requestedAt)}
                  />
                  <Detail
                    label="결제 금액"
                    value={formatMoney(selected.paymentAmount)}
                  />
                  <Detail label="수수료" value={formatMoney(selected.fee)} />
                  <Detail
                    label="정산 금액"
                    value={formatMoney(selected.settlementAmount)}
                  />
                  <Detail
                    label="완료 일시"
                    value={formatDate(selected.completedAt)}
                  />
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <section className="rounded-md border p-4">
                    <h3 className="font-medium">결제 사용자</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Detail
                        label="이름"
                        value={selected.member?.name ?? "비회원"}
                      />
                      <Detail
                        label="회원 ID"
                        value={selected.member?.loginId ?? "-"}
                      />
                      <Detail
                        label="전화번호"
                        value={selected.member?.phone ?? "-"}
                      />
                      <Detail
                        label="이메일"
                        value={selected.member?.email ?? "-"}
                      />
                    </div>
                  </section>
                  <section className="rounded-md border p-4">
                    <h3 className="font-medium">계좌 정보</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Detail
                        label="입금 계좌"
                        value={selected.fromAccount ?? "-"}
                      />
                      <Detail
                        label="수취 계좌"
                        value={selected.toAccount ?? "-"}
                      />
                      <Detail
                        label="가상계좌 은행"
                        value={selected.virtualAccount?.bankName ?? "-"}
                      />
                      <Detail
                        label="가상계좌 번호"
                        value={selected.virtualAccount?.accountNumber ?? "-"}
                      />
                    </div>
                  </section>
                </div>

                <section className="rounded-md border p-4">
                  <h3 className="font-medium">PG 이벤트 이력</h3>
                  <div className="mt-3 space-y-3">
                    {selected.events.length ? (
                      selected.events.map((event) => (
                        <div
                          key={`${event.provider}-${event.eventId}-${event.eventType}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/50 px-3 py-2 text-sm"
                        >
                          <div>
                            <p className="font-medium">{event.eventType}</p>
                            <p className="text-xs text-muted-foreground">
                              {event.provider} · {event.eventId}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(event.processedAt)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        연결된 PG 이벤트가 없습니다.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-medium">{value}</p>
    </div>
  );
}
