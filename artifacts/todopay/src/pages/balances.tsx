import React, { useState } from "react";
import { useGetBalanceSummary, useListBalanceRecords } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatDate } from "@/lib/format";
import { Loader2, TrendingUp, TrendingDown, Wallet } from "lucide-react";

export default function Balances() {
  const [type, setType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const { data: summary } = useGetBalanceSummary();
  const { data, isLoading } = useListBalanceRecords({
    type: type === "all" ? undefined : type,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    limit: 20,
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">충전금액 관리</h1>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />현재 잔액
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-primary">{formatMoney(summary.balance)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-yellow-400" />지급보류 금액
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-yellow-400">{formatMoney(summary.pendingAmount)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-400" />가용 잔액
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-green-400">{formatMoney((summary.balance ?? 0) - (summary.pendingAmount ?? 0))}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="in">입금</SelectItem>
              <SelectItem value="out">출금</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" className="w-36 md:w-40" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
            <span className="self-center text-muted-foreground text-sm">~</span>
            <Input type="date" className="w-36 md:w-40" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
          </div>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : data?.items.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-10 text-center text-muted-foreground text-sm">내역이 없습니다</CardContent>
          </Card>
        ) : data?.items.map((r) => (
          <Card key={r.id} className="bg-card/50 border-border/50">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-xs ${r.direction === "in" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                    {r.direction === "in" ? "입금" : "출금"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{r.category === "payment" ? "결제" : "출금"}</span>
                </div>
                <p className={`font-bold text-base ${r.direction === "in" ? "text-blue-400" : "text-red-400"}`}>
                  {r.direction === "in" ? "+" : "-"}{formatMoney(r.amount)}
                </p>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">{r.description ?? "—"}</span>
                <span className="text-muted-foreground">잔액 {formatMoney(r.balance)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead>구분</TableHead>
                  <TableHead>분류</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                  <TableHead className="text-right">잔액</TableHead>
                  <TableHead>설명</TableHead>
                  <TableHead>일시</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((r) => (
                  <TableRow key={r.id} className="border-border/30">
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${r.direction === "in" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                        {r.direction === "in" ? "입금" : "출금"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.category === "payment" ? "결제" : "출금"}</TableCell>
                    <TableCell className={`text-right font-medium ${r.direction === "in" ? "text-blue-400" : "text-red-400"}`}>
                      {r.direction === "in" ? "+" : "-"}{formatMoney(r.amount)}
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(r.balance)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.description ?? "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">내역이 없습니다</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>이전</Button>
          <span className="text-sm text-muted-foreground self-center">{page} / {Math.ceil(data.total / 20)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>다음</Button>
        </div>
      )}
    </div>
  );
}
