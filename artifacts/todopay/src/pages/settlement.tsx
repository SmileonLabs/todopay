import { useState } from "react";
import { useGetSettlementSummary, useListSettlementRecords } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingDown, TrendingUp, Coins, FileText, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  n != null ? n.toLocaleString("ko-KR") + "원" : "-";

const fmtPct = (fee: number, original: number) =>
  original > 0 ? ((fee / original) * 100).toFixed(2) + "%" : "-";

const PAGE_SIZE = 20;

export default function Settlement() {
  const { user } = useAuth();
  const isStore = user?.role === "store";

  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [applied, setApplied] = useState({ startDate: firstOfMonth, endDate: today });
  const [page, setPage] = useState(1);

  const summaryQuery = useGetSettlementSummary({
    startDate: applied.startDate,
    endDate: applied.endDate,
  });

  const recordsQuery = useListSettlementRecords({
    startDate: applied.startDate,
    endDate: applied.endDate,
    page,
    limit: PAGE_SIZE,
  });

  const summary = summaryQuery.data;
  const records = recordsQuery.data;
  const totalPages = records ? Math.ceil(records.total / PAGE_SIZE) : 1;

  const handleApply = () => {
    setApplied({ startDate, endDate });
    setPage(1);
  };

  const handleReset = () => {
    setStartDate(firstOfMonth);
    setEndDate(today);
    setApplied({ startDate: firstOfMonth, endDate: today });
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">수수료 정산</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isStore
            ? "입금 거래 대비 수수료 지출 현황을 확인합니다."
            : "수수료 수익 정산 내역을 확인합니다."}
        </p>
      </div>

      {/* Date filter */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">시작일</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">종료일</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40 text-sm"
              />
            </div>
            <Button size="sm" onClick={handleApply}>조회</Button>
            <Button size="sm" variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              초기화
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-5">
                <div className="h-12 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isStore ? (
        /* Store: 수수료 지출 요약 */
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
                총 입금액
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-bold text-blue-400">
                {fmt(summary?.totalDeposit)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary?.txCount ?? 0}건
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-red-400" />
                총 수수료
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-bold text-red-400">
                {fmt(summary?.totalFee)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary?.totalDeposit
                  ? fmtPct(summary.totalFee ?? 0, summary.totalDeposit)
                  : "0%"}{" "}
                수수료율
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-green-400" />
                순 수취액
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-bold text-green-400">
                {fmt(summary?.totalNet)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">입금액 - 수수료</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                평균 수수료율
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-bold">
                {summary?.totalDeposit && summary.totalDeposit > 0
                  ? fmtPct(summary.totalFee ?? 0, summary.totalDeposit)
                  : "0%"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">기간 내 평균</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Admin: 수수료 수입 요약 */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-yellow-400" />
                수수료 수입 합계
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-yellow-400">
                {fmt(summary?.totalIncome)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                기간 내 총 수수료 수익
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                정산 건수
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold">
                {(summary?.recordCount ?? 0).toLocaleString("ko-KR")}건
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                기간 내 수수료 수입 이력
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Records table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {isStore ? "수수료 지출 내역" : "수수료 수입 내역"}
            </CardTitle>
            {records && (
              <span className="text-xs text-muted-foreground">
                총 {records.total.toLocaleString("ko-KR")}건
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {isStore ? (
                    <>
                      <TableHead>처리일시</TableHead>
                      <TableHead className="text-right">입금 원금</TableHead>
                      <TableHead className="text-right">수수료</TableHead>
                      <TableHead className="text-right">수수료율</TableHead>
                      <TableHead className="text-right">순 수취액</TableHead>
                      <TableHead>추적번호</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>정산일시</TableHead>
                      <TableHead className="text-right">수수료 수입</TableHead>
                      <TableHead>내역 설명</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {recordsQuery.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: isStore ? 6 : 3 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 animate-pulse bg-muted rounded w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : records?.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isStore ? 6 : 3}
                      className="text-center text-muted-foreground py-10"
                    >
                      조회된 내역이 없습니다
                    </TableCell>
                  </TableRow>
                ) : isStore ? (
                  records?.items.map((item) => {
                    const orig = item.originalAmount ?? 0;
                    const fee = item.fee ?? 0;
                    const net = item.amount ?? 0;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleString("ko-KR")}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {orig.toLocaleString("ko-KR")}원
                        </TableCell>
                        <TableCell className="text-right text-red-400 font-medium">
                          {fee.toLocaleString("ko-KR")}원
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-xs border-red-500/40 text-red-400">
                            {fmtPct(fee, orig)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-green-400 font-medium">
                          {net.toLocaleString("ko-KR")}원
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {item.trackingNumber ?? "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  records?.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleString("ko-KR")}
                      </TableCell>
                      <TableCell className="text-right text-yellow-400 font-bold">
                        {(item.amount ?? 0).toLocaleString("ko-KR")}원
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-sm truncate">
                        {item.description ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages} 페이지
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
