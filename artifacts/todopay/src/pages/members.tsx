import React, { useState } from "react";
import {
  useListMembers,
  useCreateMember,
  useUpdateMemberStatus,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Loader2, Search, Plus, CreditCard } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Members() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [storeCode, setStoreCode] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ loginId: "", password: "", name: "", phone: "", email: "", storeCode: "" });

  const { data, isLoading } = useListMembers({
    search: search || undefined,
    storeCode: storeCode || undefined,
    page,
    limit: 20,
  });
  const create = useCreateMember();
  const updateStatus = useUpdateMemberStatus();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/members"] });

  const handleCreate = () => {
    create.mutate({ data: form }, {
      onSuccess: () => {
        toast({ title: "회원 등록 완료" });
        setCreateOpen(false);
        setForm({ loginId: "", password: "", name: "", phone: "", email: "", storeCode: "" });
        invalidate();
      },
      onError: () => toast({ title: "등록 실패", variant: "destructive" }),
    });
  };

  const handleToggle = (id: number, current: boolean) => {
    updateStatus.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => { toast({ title: !current ? "회원 활성화" : "회원 비활성화" }); invalidate(); },
      onError: () => toast({ title: "상태 변경 실패", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">회원 관리</h1>
        <Button onClick={() => setCreateOpen(true)} className="bg-primary text-black hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />회원 등록
        </Button>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="이름 / 아이디 / 전화번호 검색" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Input placeholder="매장 코드" className="w-36" value={storeCode} onChange={(e) => { setStoreCode(e.target.value); setPage(1); }} />
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
                  <TableHead>아이디</TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead>전화번호</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead>매장</TableHead>
                  <TableHead>가상계좌</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>가입일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((m) => (
                  <TableRow key={m.id} className="border-border/30">
                    <TableCell className="font-mono text-sm">{m.loginId}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-sm">{m.phone}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <div className="text-sm">{m.storeName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{m.storeCode}</div>
                    </TableCell>
                    <TableCell>
                      {m.virtualAccountNumber ? (
                        <div className="flex items-center gap-1 text-xs">
                          <CreditCard className="h-3 w-3 text-primary" />
                          <span className="font-mono">{m.virtualAccountBank} {m.virtualAccountNumber}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">미발급</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch checked={m.isActive} onCheckedChange={() => handleToggle(m.id, m.isActive)} />
                        <Badge variant="outline" className={`text-xs ${m.isActive ? "border-green-500/30 text-green-400" : "border-slate-500/30 text-slate-400"}`}>
                          {m.isActive ? "활성" : "비활성"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(m.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">회원이 없습니다</TableCell></TableRow>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>회원 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "아이디", key: "loginId", placeholder: "아이디" },
              { label: "비밀번호", key: "password", placeholder: "비밀번호", type: "password" },
              { label: "이름", key: "name", placeholder: "이름" },
              { label: "전화번호", key: "phone", placeholder: "010-0000-0000" },
              { label: "이메일", key: "email", placeholder: "email@example.com" },
              { label: "매장 코드", key: "storeCode", placeholder: "STORE001" },
            ].map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type={f.type ?? "text"}
                  placeholder={f.placeholder}
                  value={(form as Record<string, string>)[f.key]}
                  onChange={(e) => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
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
