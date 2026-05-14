import React, { useState } from "react";
import {
  useGetBalanceSummary,
  useListBalanceRecords,
  useCreateBalanceRecord,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { formatMoney, formatDate } from "@/lib/format";
import { Loader2, TrendingUp, TrendingDown, Wallet, PlusCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORY_LABEL: Record<string, string> = {
  deposit:    "입금확인",
  withdrawal: "출금승인",
  refund:     "반려복원",
  charge:     "충전",
  adjustment: "조정",
  payment:    "수수료수당",
};

const CATEGORY_COLOR: Record<string, string> = {
  deposit:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
  withdrawal: "bg-red-500/20 text-red-400 border-red-500/30",
  refund:     "bg-amber-500/20 text-amber-400 border-amber-500/30",
  charge:     "bg-green-500/20 text-green-400 border-green-500/30",
  adjustment: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  payment:    "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

export default function Balances() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [type, setType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  // 수동 입력 다이얼로그
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    direction: "in",
    category: "charge",
    amount: "",
    description: "",
  });
  const [formError, setFormError] = useState("");

  const { data: summary, refetch: refetchSummary } = useGetBalanceSummary();
  const { data, isLoading, refetch: refetchList } = useListBalanceRecords({
    type: type === "all" ? undefined : type,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    limit: 20,
  });
  const create = useCreateBalanceRecord();

  const invalidate = () => {
    void refetchSummary();
    void refetchList();
    void qc.invalidateQueries({ queryKey: ["/api/balances"] });
    void qc.invalidateQueries({ queryKey: ["/api/balances/summary"] });
  };

  const handleCreate = () => {
    const num = Number(form.amount.replace(/,/g, ""));
    if (!num || num <= 0) { setFormError("금액을 올바르게 입력해주세요"); return; }
    setFormError("");

    create.mutate(
      {
        data: {
          direction: form.direction,
          category: form.category,
          amount: num,
          description: form.description || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "잔액 기록이 추가됐습니다" });
          setDialogOpen(false);
          setForm({ direction: "in", category: "charge", amount: "", description: "" });
          invalidate();
        },
        onError: () => toast({ title: "추가 실패", variant: "destructive" }),
      }
    );
  };

  const availableBalance = (summary?.balance ?? 0) - (summary?.pendingAmount ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">충전금액 관리</h1>
        <Button
          onClick={() => { setDialogOpen(true); setFormError(""); }}
          className="bg-primary text-black hover:bg-primary/90 gap-2"
          size="sm"
        >
          <PlusCircle className="h-4 w-4" />수동 입력
        </Button>
      </div>

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
              <p className="text-xs text-muted-foreground mt-1">승인됐으나 미지급 출금</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-400" />가용 잔액
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${availableBalance < 0 ? "text-red-400" : "text-green-400"}`}>
                {formatMoney(availableBalance)}
              </p>
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
                  <Badge variant="outline" className={`text-xs ${CATEGORY_COLOR[r.category] ?? ""}`}>
                    {CATEGORY_LABEL[r.category] ?? r.category}
                  </Badge>
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
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${CATEGORY_COLOR[r.category] ?? ""}`}>
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${r.direction === "in" ? "text-blue-400" : "text-red-400"}`}>
                      {r.direction === "in" ? "+" : "-"}{formatMoney(r.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.balance)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{r.description ?? "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      내역이 없습니다
                    </TableCell>
                  </TableRow>
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

      {/* 수동 입력 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setFormError(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>잔액 수동 입력</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">방향</Label>
                <Select value={form.direction} onValueChange={(v) => setForm(f => ({ ...f, direction: v, category: v === "in" ? "charge" : "adjustment" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">입금 (in)</SelectItem>
                    <SelectItem value="out">출금 (out)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">분류</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {form.direction === "in" ? (
                      <>
                        <SelectItem value="charge">충전</SelectItem>
                        <SelectItem value="adjustment">조정</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="adjustment">조정</SelectItem>
                        <SelectItem value="payment">결제</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">금액 <span className="text-red-400">*</span></Label>
              <div className="relative">
                <Input
                  value={form.amount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "").replace(/\D/g, "");
                    setForm(f => ({ ...f, amount: raw ? Number(raw).toLocaleString("ko-KR") : "" }));
                  }}
                  placeholder="0"
                  className="pr-8 text-right font-mono"
                />
                <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">설명 (선택)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="메모를 입력하세요"
              />
            </div>

            {formError && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{formError}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
            <Button
              onClick={handleCreate}
              disabled={create.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
