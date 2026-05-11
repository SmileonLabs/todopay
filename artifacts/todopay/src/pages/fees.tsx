import React, { useState } from "react";
import { useListFees, useCreateFeeConfig, useUpdateFeeConfig } from "@workspace/api-client-react";
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
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { FeeConfig } from "@workspace/api-client-react";

const ROLE_LABELS: Record<string, string> = { superadmin: "슈퍼관리자", hq: "본사", distributor: "총판", agency: "대리점", store: "매장" };
const ROLE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/30 text-purple-400",
  hq: "border-blue-500/30 text-blue-400",
  distributor: "border-green-500/30 text-green-400",
  agency: "border-orange-500/30 text-orange-400",
  store: "border-yellow-500/30 text-yellow-400",
};

export default function Fees() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<FeeConfig | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [depositFee, setDepositFee] = useState("");
  const [withdrawalFee, setWithdrawalFee] = useState("");
  const [newUserId, setNewUserId] = useState("");

  const { data, isLoading } = useListFees({});
  const update = useUpdateFeeConfig();
  const create = useCreateFeeConfig();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/fees"] });

  const openEdit = (fc: FeeConfig) => {
    setEditTarget(fc);
    setDepositFee(String(fc.depositFee));
    setWithdrawalFee(String(fc.withdrawalFee));
  };

  const handleUpdate = () => {
    if (!editTarget) return;
    update.mutate({ id: editTarget.id, data: { depositFee: parseFloat(depositFee), withdrawalFee: parseFloat(withdrawalFee) } }, {
      onSuccess: () => { toast({ title: "수수료 수정 완료" }); setEditTarget(null); invalidate(); },
      onError: () => toast({ title: "수정 실패", variant: "destructive" }),
    });
  };

  const handleCreate = () => {
    create.mutate({ data: { userId: parseInt(newUserId), depositFee: parseFloat(depositFee), withdrawalFee: parseFloat(withdrawalFee) } }, {
      onSuccess: () => { toast({ title: "수수료 등록 완료" }); setCreateOpen(false); setNewUserId(""); setDepositFee(""); setWithdrawalFee(""); invalidate(); },
      onError: () => toast({ title: "등록 실패", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">수수료 설정</h1>
          <p className="text-muted-foreground mt-1">각 유저별 입금·출금 수수료율을 설정합니다 (%)</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); setDepositFee(""); setWithdrawalFee(""); setNewUserId(""); }} className="bg-primary text-black hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />수수료 등록
        </Button>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead>유저명</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead className="text-right">입금 수수료</TableHead>
                  <TableHead className="text-right">출금 수수료</TableHead>
                  <TableHead>등록일</TableHead>
                  <TableHead>수정</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((fc) => (
                  <TableRow key={fc.id} className="border-border/30">
                    <TableCell className="font-medium">{fc.userName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${ROLE_COLORS[fc.role] ?? ""}`}>{ROLE_LABELS[fc.role] ?? fc.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-primary">{fc.depositFee}%</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-primary">{fc.withdrawalFee}%</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(fc.createdAt)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(fc)}>
                        <Pencil className="h-3 w-3 mr-1" />수정
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {data?.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">수수료 설정이 없습니다</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editTarget?.userName} 수수료 수정</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>입금 수수료 (%)</Label>
              <Input type="number" step="0.01" min="0" max="100" value={depositFee} onChange={(e) => setDepositFee(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>출금 수수료 (%)</Label>
              <Input type="number" step="0.01" min="0" max="100" value={withdrawalFee} onChange={(e) => setWithdrawalFee(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>취소</Button>
            <Button onClick={handleUpdate} disabled={update.isPending} className="bg-primary text-black hover:bg-primary/90">
              {update.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>수수료 등록</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>유저 ID</Label>
              <Input type="number" placeholder="유저 ID 입력" value={newUserId} onChange={(e) => setNewUserId(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>입금 수수료 (%)</Label>
                <Input type="number" step="0.01" min="0" max="100" value={depositFee} onChange={(e) => setDepositFee(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>출금 수수료 (%)</Label>
                <Input type="number" step="0.01" min="0" max="100" value={withdrawalFee} onChange={(e) => setWithdrawalFee(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
            <Button onClick={handleCreate} disabled={create.isPending} className="bg-primary text-black hover:bg-primary/90">
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
