import React, { useState } from "react";
import { useListTransactions, useConfirmTransaction } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loader2, Search, CheckCircle2, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const TYPE_COLORS: Record<string, string> = {
  deposit: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  withdrawal: "bg-red-500/20 text-red-400 border-red-500/30",
};
const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

function PendingDeposits() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const params: Record<string, unknown> = { type: "deposit", status: "pending", limit: 50 };
  if (user?.role === "store") params.storeId = user.id;

  const { data, isLoading, refetch } = useListTransactions(params as Parameters<typeof useListTransactions>[0]);
  const confirmMutation = useConfirmTransaction();

  const handleConfirm = async (id: number) => {
    setConfirmingId(id);
    try {
      await confirmMutation.mutateAsync({ id });
      toast({ title: "입금 확인 처리 완료" });
      void refetch();
      void queryClient.invalidateQueries();
    } catch {
      toast({ title: "처리 실패", variant: "destructive" });
    } finally {
      setConfirmingId(null);
    }
  };

  const items = data?.items ?? [];

  return (
    <Card className="bg-card/50 border-yellow-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-yellow-400" />
          입금 대기 목록
          {items.length > 0 && (
            <Badge variant="outline" className="ml-1 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
              {items.length}건
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">대기 중인 입금 신청이 없습니다</div>
        ) : (
          <>
            {/* Mobile */}
            <div className="md:hidden divide-y divide-border/30">
              {items.map((t) => (
                <div key={t.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</p>
                      <p className="font-semibold mt-0.5">{t.memberName ?? "-"}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</p>
                    </div>
                    <p className="font-bold text-primary text-lg">{formatMoney(t.amount)}</p>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono flex gap-2 flex-wrap">
                    <span>{t.fromAccount}</span>
                    <span>→</span>
                    <span>{t.toAccount}</span>
                  </div>
                  <Button onClick={() => void handleConfirm(t.id)} disabled={confirmingId === t.id}
                    className="w-full bg-green-600 hover:bg-green-700 text-white h-8 text-xs">
                    {confirmingId === t.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />확인 처리</>}
                  </Button>
                </div>
              ))}
            </div>
            {/* Desktop */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>추적번호</TableHead>
                    <TableHead>회원명</TableHead>
                    <TableHead>출금계좌</TableHead>
                    <TableHead>입금계좌</TableHead>
                    <TableHead className="text-right">금액</TableHead>
                    <TableHead>신청일시</TableHead>
                    <TableHead className="text-center">처리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => (
                    <TableRow key={t.id} className="border-border/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</TableCell>
                      <TableCell>{t.memberName ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{t.fromAccount}</TableCell>
                      <TableCell className="font-mono text-xs">{t.toAccount}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{formatMoney(t.amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(t.createdAt)}</TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" onClick={() => void handleConfirm(t.id)} disabled={confirmingId === t.id}
                          className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs px-3">
                          {confirmingId === t.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />확인 처리</>}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

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
    <div className="space-y-5">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">입출금 내역</h1>

      <PendingDeposits />

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="추적번호 / 계좌 검색" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="deposit">입금</SelectItem>
              <SelectItem value="withdrawal">출금</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" className="w-36 md:w-40" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
            <span className="text-muted-foreground text-sm">~</span>
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
            <CardContent className="py-10 text-center text-muted-foreground text-sm">거래 내역이 없습니다</CardContent>
          </Card>
        ) : data?.items.map((t) => (
          <Card key={t.id} className="bg-card/50 border-border/50">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</p>
                  <p className="font-semibold mt-0.5">{t.memberName ?? "-"}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Badge variant="outline" className={`text-xs ${TYPE_COLORS[t.type] ?? ""}`}>
                    {t.type === "deposit" ? "입금" : "출금"}
                  </Badge>
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[t.status] ?? ""}`}>
                    {t.status === "success" ? "성공" : t.status === "failed" ? "실패" : "대기"}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">원금</p>
                  <p>{formatMoney(t.originalAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">실금액</p>
                  <p className="font-bold text-primary">{formatMoney(t.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">수수료</p>
                  <p className="text-muted-foreground">{formatMoney(t.fee)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground font-mono">{formatDate(t.createdAt)}</p>
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
                  <TableHead>추적번호</TableHead>
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
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">거래 내역이 없습니다</TableCell></TableRow>
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
