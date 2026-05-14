import React, { useState } from "react";
import {
  useListWithdrawals,
  useGetWithdrawalSummary,
  useApproveWithdrawal,
  useRejectWithdrawal,
  useListUsers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { formatMoney, formatDate } from "@/lib/format";
import { CheckCircle, XCircle, Loader2, Search, Clock, AlertCircle, Plus, Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";

const APPROVAL_LABELS: Record<string, string> = { pending: "대기", approved: "승인", rejected: "반려" };
const APPROVAL_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};
const PAID_COLORS: Record<string, string> = {
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  unpaid: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};
const BANKS = ["국민은행", "신한은행", "우리은행", "하나은행", "기업은행", "농협은행", "카카오뱅크", "토스뱅크", "SC제일은행", "씨티은행", "대구은행", "부산은행", "경남은행", "전북은행", "광주은행", "제주은행"];

type WithdrawalItem = {
  id: number; trackingNumber: string; amount: number; fee: number; totalAmount: number;
  approvalStatus: string; withdrawalStatus: string; accountNumber: string; accountBank: string;
  accountHolder: string; rejectReason?: string | null; memberName?: string | null;
  storeName?: string | null; storeId?: number | null; availableAt?: string | null; createdAt: string;
};

function AvailableAtBadge({ availableAt }: { availableAt?: string | null }) {
  if (!availableAt) return null;
  const at = new Date(availableAt);
  if (new Date() >= at) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-amber-400 mt-0.5">
      <Clock className="h-2.5 w-2.5" />
      <span>{at.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} 이후</span>
    </div>
  );
}

// ——————————————————————————————————————————————
// 출금 신청 다이얼로그
// ——————————————————————————————————————————————
function CreateWithdrawalDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isStore = user?.role === "store";

  // 매장 계정은 드롭다운 불필요 — 항상 호출하되 isStore일 때는 UI에서 무시
  const { data: storeList } = useListUsers({ role: "store" });

  const [form, setForm] = useState({
    storeId: isStore ? String(user?.id ?? "") : "",
    amount: "",
    accountBank: BANKS[0],
    accountNumber: "",
    accountHolder: "",
  });
  const [storeBalance, setStoreBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadBalance = async (sid: string) => {
    if (!sid) { setStoreBalance(null); return; }
    try {
      const res = await axios.get(`/api/store/${sid}/balance`);
      setStoreBalance((res.data as { balance: number }).balance);
    } catch { setStoreBalance(null); }
  };

  React.useEffect(() => {
    if (isStore && user?.id) {
      void loadBalance(String(user.id));
    }
  }, [isStore, user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount.replace(/,/g, ""));
    if (!form.storeId) { setError("매장을 선택해주세요"); return; }
    if (!amt || amt < 1000) { setError("최소 출금액은 1,000원입니다"); return; }
    if (!form.accountNumber.trim()) { setError("계좌번호를 입력해주세요"); return; }
    if (!form.accountHolder.trim()) { setError("예금주를 입력해주세요"); return; }
    setError(""); setLoading(true);
    try {
      await axios.post("/api/withdrawals", {
        storeId: Number(form.storeId),
        amount: amt,
        accountBank: form.accountBank,
        accountNumber: form.accountNumber.replace(/\D/g, ""),
        accountHolder: form.accountHolder.trim(),
      });
      toast({ title: "출금 신청 완료", description: "익일 오전 10시 이후 승인 처리됩니다" });
      setForm({ storeId: isStore ? String(user?.id ?? "") : "", amount: "", accountBank: BANKS[0], accountNumber: "", accountHolder: "" });
      onSuccess();
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "출금 신청 실패";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const stores = (storeList?.items ?? []);
  const selectedStore = stores.find(s => String(s.id) === form.storeId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />매장 출금 신청
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* 매장 선택 (store 계정은 자신이 자동으로 선택됨) */}
          {isStore ? (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-sm">
              <span className="text-muted-foreground">매장: </span>
              <span className="font-medium">{user?.name}</span>
              {storeBalance != null && (
                <span className="ml-2 text-primary font-bold">잔액 {storeBalance.toLocaleString("ko-KR")}원</span>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">매장 선택 <span className="text-red-400">*</span></Label>
              <Select value={form.storeId} onValueChange={(v) => { setForm(p => ({ ...p, storeId: v })); void loadBalance(v); }}>
                <SelectTrigger><SelectValue placeholder="매장 선택..." /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} <span className="text-muted-foreground text-xs">({s.loginId})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStore && storeBalance != null && (
                <p className="text-xs text-primary">현재 잔액: <strong>{storeBalance.toLocaleString("ko-KR")}원</strong></p>
              )}
            </div>
          )}

          {/* 출금액 */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">출금액 <span className="text-red-400">*</span></Label>
            <div className="relative">
              <Input
                value={form.amount}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, "").replace(/\D/g, "");
                  setForm(p => ({ ...p, amount: raw ? Number(raw).toLocaleString("ko-KR") : "" }));
                }}
                placeholder="0"
                className="pr-8 text-right font-mono"
              />
              <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
            </div>
            {storeBalance != null && (
              <div className="flex gap-1.5 flex-wrap">
                {[100000, 500000, 1000000].map(v => (
                  <button key={v} type="button" onClick={() => setForm(p => ({ ...p, amount: v.toLocaleString("ko-KR") }))}
                    className="text-xs px-2 py-0.5 rounded bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground">
                    {v.toLocaleString("ko-KR")}원
                  </button>
                ))}
                <button type="button" onClick={() => setForm(p => ({ ...p, amount: Math.floor(storeBalance).toLocaleString("ko-KR") }))}
                  className="text-xs px-2 py-0.5 rounded bg-muted/50 hover:bg-muted border border-border/50 text-primary">
                  전액
                </button>
              </div>
            )}
          </div>

          {/* 계좌 정보 */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">출금 은행</Label>
            <Select value={form.accountBank} onValueChange={(v) => setForm(p => ({ ...p, accountBank: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">계좌번호 <span className="text-red-400">*</span></Label>
            <Input value={form.accountNumber} onChange={(e) => setForm(p => ({ ...p, accountNumber: e.target.value }))} placeholder="- 없이 숫자만" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">예금주 <span className="text-red-400">*</span></Label>
            <Input value={form.accountHolder} onChange={(e) => setForm(p => ({ ...p, accountHolder: e.target.value }))} placeholder="예금주명" />
          </div>

          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <div className="rounded-lg bg-amber-400/5 border border-amber-400/20 px-3 py-2 text-xs text-amber-400/80">
            출금 신청 후 <strong>익일 오전 10시 (KST)</strong> 이후 담당자 승인 처리됩니다.
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={loading} className="bg-primary text-black hover:bg-primary/90">
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />처리 중...</> : "출금 신청"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ——————————————————————————————————————————————
// Main page
// ——————————————————————————————————————————————
export default function Withdrawals() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = user?.role === "store";

  const params = {
    search: search || undefined,
    approvalStatus: approvalStatus === "all" ? undefined : approvalStatus,
    page,
    limit: 20,
  };

  const { data, isLoading } = useListWithdrawals(params);
  const { data: summary } = useGetWithdrawalSummary();
  const approve = useApproveWithdrawal();
  const reject = useRejectWithdrawal();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["/api/withdrawals"] });
    void qc.invalidateQueries({ queryKey: ["/api/withdrawals/summary"] });
    void qc.invalidateQueries({ queryKey: ["/api/statistics/overview"] });
  };

  const handleApprove = (w: WithdrawalItem) => {
    if (w.availableAt && new Date() < new Date(w.availableAt)) {
      const kst = new Date(w.availableAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
      toast({ title: `출금 가능 시간 전입니다 (${kst} 이후)`, variant: "destructive" });
      return;
    }
    approve.mutate({ id: w.id }, {
      onSuccess: () => { toast({ title: "출금 승인 완료" }); invalidate(); },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "승인 실패";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  const handleReject = () => {
    if (!rejectDialogId) return;
    reject.mutate({ id: rejectDialogId, data: { reason: rejectReason } }, {
      onSuccess: () => { toast({ title: "출금 반려 완료" }); setRejectDialogId(null); setRejectReason(""); invalidate(); },
      onError: () => toast({ title: "반려 실패", variant: "destructive" }),
    });
  };

  const items = (data?.items ?? []) as WithdrawalItem[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">출금 관리</h1>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-black hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1.5" />출금 신청
          </Button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: "대기 건수", value: `${summary.pendingCount}건`, color: "text-yellow-400" },
            { label: "대기 금액", value: formatMoney(summary.pendingAmount), color: "text-yellow-400" },
            { label: "승인 건수", value: `${summary.approvedCount}건`, color: "text-green-400" },
            { label: "승인 금액", value: formatMoney(summary.approvedAmount), color: "text-green-400" },
            { label: "오늘 출금", value: formatMoney(summary.todayWithdrawn), color: "text-primary" },
          ].map((s) => (
            <Card key={s.label} className="bg-card/50 border-border/50">
              <CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">{s.label}</CardTitle></CardHeader>
              <CardContent className="px-3 pb-3"><p className={`text-base md:text-lg font-bold ${s.color}`}>{s.value}</p></CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 익일 10시 안내 */}
      <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-md px-3 py-2">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>매장 출금 신청은 <strong>익일 오전 10시 (KST)</strong> 이후에 승인 처리 가능합니다. 매장 잔액은 구매 확인 시 자동 적립됩니다.</span>
      </div>

      {/* Filters */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="추적번호 / 매장명 검색" className="pl-9" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={approvalStatus} onValueChange={(v) => { setApprovalStatus(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="pending">대기</SelectItem>
              <SelectItem value="approved">승인</SelectItem>
              <SelectItem value="rejected">반려</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-10 text-center text-muted-foreground text-sm">출금 내역이 없습니다</CardContent>
          </Card>
        ) : items.map((w) => (
          <Card key={w.id} className="bg-card/50 border-border/50">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{w.trackingNumber}</p>
                  <p className="font-semibold mt-0.5">{w.storeName ?? w.memberName ?? "-"}</p>
                  <AvailableAtBadge availableAt={w.availableAt} />
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                  <Badge variant="outline" className={`text-xs ${APPROVAL_COLORS[w.approvalStatus] ?? ""}`}>
                    {APPROVAL_LABELS[w.approvalStatus] ?? w.approvalStatus}
                  </Badge>
                  <Badge variant="outline" className={`text-xs ${PAID_COLORS[w.withdrawalStatus] ?? ""}`}>
                    {w.withdrawalStatus === "paid" ? "지급" : "미지급"}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">은행/계좌</p>
                  <p className="font-medium">{w.accountBank}</p>
                  <p className="font-mono text-xs text-muted-foreground">{w.accountNumber}</p>
                </div>
                <div><p className="text-xs text-muted-foreground">예금주</p><p>{w.accountHolder}</p></div>
                <div><p className="text-xs text-muted-foreground">출금액</p><p className="font-bold text-primary">{formatMoney(w.amount)}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">수수료 / 실지급</p>
                  <p className="text-xs text-muted-foreground">{formatMoney(w.fee)} / <span className="text-foreground font-medium">{formatMoney(w.totalAmount)}</span></p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                <p className="text-xs text-muted-foreground">{formatDate(w.createdAt)}</p>
                {w.approvalStatus === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => handleApprove(w)}>
                      <CheckCircle className="h-3 w-3 mr-1" />승인
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => { setRejectDialogId(w.id); setRejectReason(""); }}>
                      <XCircle className="h-3 w-3 mr-1" />반려
                    </Button>
                  </div>
                )}
              </div>
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
                  <TableHead>매장명</TableHead>
                  <TableHead>은행 / 계좌</TableHead>
                  <TableHead>예금주</TableHead>
                  <TableHead className="text-right">출금액</TableHead>
                  <TableHead className="text-right">수수료</TableHead>
                  <TableHead className="text-right">실지급</TableHead>
                  <TableHead>승인</TableHead>
                  <TableHead>지급</TableHead>
                  <TableHead>승인 가능 시각</TableHead>
                  <TableHead>신청일시</TableHead>
                  <TableHead>처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w) => {
                  const isAvailable = !w.availableAt || new Date() >= new Date(w.availableAt);
                  const availableKst = w.availableAt
                    ? new Date(w.availableAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })
                    : null;
                  return (
                    <TableRow key={w.id} className="border-border/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">{w.trackingNumber}</TableCell>
                      <TableCell className="font-medium">{w.storeName ?? w.memberName ?? "-"}</TableCell>
                      <TableCell className="text-sm">{w.accountBank}<br /><span className="font-mono text-xs text-muted-foreground">{w.accountNumber}</span></TableCell>
                      <TableCell>{w.accountHolder}</TableCell>
                      <TableCell className="text-right font-medium">{formatMoney(w.amount)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatMoney(w.fee)}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{formatMoney(w.totalAmount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${APPROVAL_COLORS[w.approvalStatus] ?? ""}`}>
                          {APPROVAL_LABELS[w.approvalStatus] ?? w.approvalStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${PAID_COLORS[w.withdrawalStatus] ?? ""}`}>
                          {w.withdrawalStatus === "paid" ? "지급완료" : "미지급"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {availableKst
                          ? <span className={isAvailable ? "text-green-400" : "text-amber-400"}>{isAvailable ? "✓ 가능" : availableKst}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(w.createdAt)}</TableCell>
                      <TableCell>
                        {w.approvalStatus === "pending" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline"
                              className={`h-7 text-xs ${isAvailable ? "border-green-500/30 text-green-400 hover:bg-green-500/10" : "border-amber-500/30 text-amber-400 opacity-70"}`}
                              onClick={() => handleApprove(w)}>
                              <CheckCircle className="h-3 w-3 mr-1" />승인
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                              onClick={() => { setRejectDialogId(w.id); setRejectReason(""); }}>
                              <XCircle className="h-3 w-3 mr-1" />반려
                            </Button>
                          </div>
                        )}
                        {w.approvalStatus === "rejected" && w.rejectReason && (
                          <span className="text-xs text-muted-foreground">{w.rejectReason}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {items.length === 0 && (
                  <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">출금 내역이 없습니다</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>이전</Button>
          <span className="text-sm text-muted-foreground self-center">{page} / {Math.ceil(data.total / 20)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>다음</Button>
        </div>
      )}

      {/* Create withdrawal dialog */}
      <CreateWithdrawalDialog open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={invalidate} />

      {/* Reject dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={(o) => !o && setRejectDialogId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>출금 반려</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">반려 사유</label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유 입력" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogId(null)}>취소</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim() || reject.isPending}>
              {reject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}반려 처리
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
