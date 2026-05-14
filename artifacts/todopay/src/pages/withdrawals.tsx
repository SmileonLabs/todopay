import React, { useState } from "react";
import {
  useListWithdrawals,
  useGetWithdrawalSummary,
  useApproveWithdrawal,
  useRejectWithdrawal,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { formatMoney, formatDate } from "@/lib/format";
import { CheckCircle, XCircle, Loader2, Search, Clock, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const APPROVAL_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};
const APPROVAL_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};
const PAID_COLORS: Record<string, string> = {
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  unpaid: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

type WithdrawalItem = {
  id: number;
  trackingNumber: string;
  amount: number;
  fee: number;
  totalAmount: number;
  approvalStatus: string;
  withdrawalStatus: string;
  accountNumber: string;
  accountBank: string;
  accountHolder: string;
  rejectReason?: string | null;
  memberName?: string | null;
  storeName?: string | null;
  storeId?: number | null;
  availableAt?: string | null;
  createdAt: string;
};

function AvailableAtBadge({ availableAt }: { availableAt?: string | null }) {
  if (!availableAt) return null;
  const now = new Date();
  const at = new Date(availableAt);
  if (now >= at) return null;
  const kstStr = at.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
  });
  return (
    <div className="flex items-center gap-1 text-[10px] text-amber-400 mt-0.5">
      <Clock className="h-2.5 w-2.5" />
      <span>{kstStr} 이후 승인 가능</span>
    </div>
  );
}

export default function Withdrawals() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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
    if (w.availableAt) {
      const now = new Date();
      const at = new Date(w.availableAt);
      if (now < at) {
        const kstStr = at.toLocaleString("ko-KR", {
          month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
        });
        toast({ title: `아직 출금 가능 시간이 아닙니다 (${kstStr} 이후)`, variant: "destructive" });
        return;
      }
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
      onSuccess: () => {
        toast({ title: "출금 반려 완료" });
        setRejectDialogId(null);
        setRejectReason("");
        invalidate();
      },
      onError: () => toast({ title: "반려 실패", variant: "destructive" }),
    });
  };

  const items = (data?.items ?? []) as WithdrawalItem[];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">출금 관리</h1>

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

      {/* Filters */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="추적번호 / 매장명 검색" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
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

      {/* 익일 10시 안내 */}
      <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-md px-3 py-2">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>매장 출금 신청은 익일 오전 10시 (KST) 이후에 승인 처리됩니다.</span>
      </div>

      {/* Mobile card list */}
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
                <div className="flex gap-1.5 shrink-0">
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
                <div>
                  <p className="text-xs text-muted-foreground">예금주</p>
                  <p>{w.accountHolder}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">출금액</p>
                  <p className="font-bold text-primary">{formatMoney(w.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">수수료 / 실지급</p>
                  <p className="text-muted-foreground text-xs">{formatMoney(w.fee)} / <span className="text-foreground font-medium">{formatMoney(w.totalAmount)}</span></p>
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
                {w.approvalStatus === "rejected" && w.rejectReason && (
                  <span className="text-xs text-muted-foreground">{w.rejectReason}</span>
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
                  <TableHead>은행/계좌</TableHead>
                  <TableHead>예금주</TableHead>
                  <TableHead className="text-right">출금액</TableHead>
                  <TableHead className="text-right">수수료</TableHead>
                  <TableHead className="text-right">실지급</TableHead>
                  <TableHead>승인상태</TableHead>
                  <TableHead>지급상태</TableHead>
                  <TableHead>승인 가능 시각</TableHead>
                  <TableHead>신청일시</TableHead>
                  <TableHead>처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w) => {
                  const isAvailable = !w.availableAt || new Date() >= new Date(w.availableAt);
                  const availableKst = w.availableAt
                    ? new Date(w.availableAt).toLocaleString("ko-KR", {
                        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
                      })
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
                        {availableKst ? (
                          <span className={isAvailable ? "text-green-400" : "text-amber-400"}>
                            {isAvailable ? "✓ 가능" : availableKst}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(w.createdAt)}</TableCell>
                      <TableCell>
                        {w.approvalStatus === "pending" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 text-xs ${isAvailable ? "border-green-500/30 text-green-400 hover:bg-green-500/10" : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10 opacity-60"}`}
                              onClick={() => handleApprove(w)}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />승인
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => { setRejectDialogId(w.id); setRejectReason(""); }}>
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

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={(o) => !o && setRejectDialogId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>출금 반려</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">반려 사유</label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유를 입력하세요" />
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
