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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatMoney, formatDate } from "@/lib/format";
import { CheckCircle, XCircle, Clock, Loader2, Search } from "lucide-react";
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

  const handleApprove = (id: number) => {
    approve.mutate({ id }, {
      onSuccess: () => { toast({ title: "출금 승인 완료" }); invalidate(); },
      onError: () => toast({ title: "승인 실패", variant: "destructive" }),
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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">출금 관리</h1>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: "대기 건수", value: `${summary.pendingCount}건`, color: "text-yellow-400" },
            { label: "대기 금액", value: formatMoney(summary.pendingAmount), color: "text-yellow-400" },
            { label: "승인 건수", value: `${summary.approvedCount}건`, color: "text-green-400" },
            { label: "승인 금액", value: formatMoney(summary.approvedAmount), color: "text-green-400" },
            { label: "오늘 출금", value: formatMoney(summary.todayWithdrawn), color: "text-primary" },
          ].map((s) => (
            <Card key={s.label} className="bg-card/50 border-border/50">
              <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs text-muted-foreground">{s.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4"><p className={`text-lg font-bold ${s.color}`}>{s.value}</p></CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="추적번호 / 회원명 검색" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={approvalStatus} onValueChange={(v) => { setApprovalStatus(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="pending">대기</SelectItem>
              <SelectItem value="approved">승인</SelectItem>
              <SelectItem value="rejected">반려</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead>추적번호</TableHead>
                  <TableHead>회원명</TableHead>
                  <TableHead>은행/계좌</TableHead>
                  <TableHead>예금주</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                  <TableHead className="text-right">수수료</TableHead>
                  <TableHead>승인상태</TableHead>
                  <TableHead>지급상태</TableHead>
                  <TableHead>신청일시</TableHead>
                  <TableHead>처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((w) => (
                  <TableRow key={w.id} className="border-border/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">{w.trackingNumber}</TableCell>
                    <TableCell>{w.memberName ?? "-"}</TableCell>
                    <TableCell className="text-sm">{w.accountBank}<br /><span className="font-mono text-xs text-muted-foreground">{w.accountNumber}</span></TableCell>
                    <TableCell>{w.accountHolder}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(w.amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatMoney(w.fee)}</TableCell>
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
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(w.createdAt)}</TableCell>
                    <TableCell>
                      {w.approvalStatus === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => handleApprove(w.id)}>
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
                ))}
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">출금 내역이 없습니다</TableCell></TableRow>
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
