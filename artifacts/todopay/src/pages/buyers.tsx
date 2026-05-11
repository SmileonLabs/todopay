import React, { useState } from "react";
import {
  useListBuyers,
  useCreateBuyer,
  useDeleteBuyer,
  useReissueBuyerVirtualAccount,
  useGetBuyerRegisterLink,
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
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Loader2, Search, Plus, Link, RefreshCw, Trash2, Copy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Buyers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [form, setForm] = useState({ name: "", loginId: "", password: "", phone: "", birthdate: "" });

  const { data, isLoading } = useListBuyers({
    search: search || undefined,
    page,
    limit: 20,
  });
  const { data: regLink } = useGetBuyerRegisterLink();
  const create = useCreateBuyer();
  const del = useDeleteBuyer();
  const reissue = useReissueBuyerVirtualAccount();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/buyers"] });

  const handleCreate = () => {
    create.mutate({ data: form }, {
      onSuccess: () => {
        toast({ title: "구매자 등록 완료" });
        setCreateOpen(false);
        setForm({ name: "", loginId: "", password: "", phone: "", birthdate: "" });
        invalidate();
      },
      onError: () => toast({ title: "등록 실패", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("구매자를 삭제하시겠습니까?")) return;
    del.mutate({ id }, {
      onSuccess: () => { toast({ title: "삭제 완료" }); invalidate(); },
      onError: () => toast({ title: "삭제 실패", variant: "destructive" }),
    });
  };

  const handleReissue = (id: number) => {
    if (!confirm("가상계좌를 재발급하시겠습니까?")) return;
    reissue.mutate({ id }, {
      onSuccess: () => { toast({ title: "가상계좌 재발급 완료" }); invalidate(); },
      onError: () => toast({ title: "재발급 실패", variant: "destructive" }),
    });
  };

  const copyLink = () => {
    if (regLink?.url) {
      void navigator.clipboard.writeText(regLink.url);
      toast({ title: "링크가 복사되었습니다" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold tracking-tight">구매자 관리</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLinkOpen(true)}>
            <Link className="h-4 w-4 mr-2" />등록 링크
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-black hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />구매자 등록
          </Button>
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="이름 / 아이디 / 전화번호 검색" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
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
                  <TableHead>생년월일</TableHead>
                  <TableHead>가상계좌</TableHead>
                  <TableHead>계좌상태</TableHead>
                  <TableHead>본인인증</TableHead>
                  <TableHead>등록일</TableHead>
                  <TableHead>처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((b) => (
                  <TableRow key={b.id} className="border-border/30">
                    <TableCell className="font-mono text-sm">{b.loginId}</TableCell>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-sm">{b.phone}</TableCell>
                    <TableCell className="text-sm">{b.birthdate}</TableCell>
                    <TableCell>
                      <div className="text-xs font-mono">{b.virtualAccountBank}</div>
                      <div className="text-xs font-mono text-muted-foreground">{b.virtualAccountNumber}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${b.virtualAccountStatus === "active" ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"}`}>
                        {b.virtualAccountStatus === "active" ? "활성" : "해지"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${b.isVerified ? "border-blue-500/30 text-blue-400" : "border-slate-500/30 text-slate-400"}`}>
                        {b.isVerified ? "인증" : "미인증"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(b.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleReissue(b.id)} title="가상계좌 재발급">
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => handleDelete(b.id)} title="삭제">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">구매자가 없습니다</TableCell></TableRow>
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

      {/* Register Link Dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>구매자 등록 링크</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">아래 링크를 구매자에게 전달하면 직접 등록이 가능합니다.</p>
            <div className="flex gap-2">
              <Input value={regLink?.url ?? "링크 불러오는 중..."} readOnly className="font-mono text-xs" />
              <Button variant="outline" onClick={copyLink}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>구매자 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "아이디", key: "loginId" },
              { label: "비밀번호", key: "password", type: "password" },
              { label: "이름", key: "name" },
              { label: "전화번호", key: "phone", placeholder: "010-0000-0000" },
              { label: "생년월일", key: "birthdate", type: "date" },
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
