import React, { useState } from "react";
import { useListTransactions } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatDate } from "@/lib/format";
import { Loader2, Search } from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  deposit: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  withdrawal: "bg-red-500/20 text-red-400 border-red-500/30",
};
const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

export default function Transactions() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListTransactions({
    search: search || undefined,
    type: type === "all" ? undefined : type,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    limit: 20,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">입출금 내역</h1>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="추적번호 / 회원명 검색" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="deposit">입금</SelectItem>
              <SelectItem value="withdrawal">출금</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" className="w-40" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
          <span className="self-center text-muted-foreground text-sm">~</span>
          <Input type="date" className="w-40" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead>추적번호</TableHead>
                  <TableHead>PG거래ID</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>회원명</TableHead>
                  <TableHead>출금계좌</TableHead>
                  <TableHead>입금계좌</TableHead>
                  <TableHead className="text-right">원금</TableHead>
                  <TableHead className="text-right">실금액</TableHead>
                  <TableHead className="text-right">수수료</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>일시</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((t) => (
                  <TableRow key={t.id} className="border-border/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.pgTransactionId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${TYPE_COLORS[t.type] ?? ""}`}>
                        {t.type === "deposit" ? "입금" : "출금"}
                      </Badge>
                    </TableCell>
                    <TableCell>{t.memberName ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{t.fromAccount}</TableCell>
                    <TableCell className="font-mono text-xs">{t.toAccount}</TableCell>
                    <TableCell className="text-right">{formatMoney(t.originalAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(t.amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatMoney(t.fee)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[t.status] ?? ""}`}>
                        {t.status === "success" ? "성공" : t.status === "failed" ? "실패" : "대기"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center py-10 text-muted-foreground">거래 내역이 없습니다</TableCell></TableRow>
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
