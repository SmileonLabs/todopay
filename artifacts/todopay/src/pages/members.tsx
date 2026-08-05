import React, { useState } from "react";
import {
  useListMembers,
  useCreateMember,
  useUpdateMemberStatus,
  useReissueMemberVirtualAccount,
  useGetMemberRegisterLink,
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
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Loader2, Search, Plus, CreditCard, RefreshCw, Trash2, Link, Copy, CopyCheck, ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const BASE_URL = import.meta.env.BASE_URL ?? "/";

async function deleteMember(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}api/members/${id}`.replace(/\/+/g, "/").replace(":/", "://"), {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error("삭제 실패");
}

export default function Members() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [storeCode, setStoreCode] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [form, setForm] = useState({
    loginId: "", password: "", name: "", phone: "",
    email: "", storeCode: "", birthdate: "",
  });

  const { data, isLoading } = useListMembers({
    search: search || undefined,
    storeCode: storeCode || undefined,
    page,
    limit: 20,
  });
  const create = useCreateMember();
  const updateStatus = useUpdateMemberStatus();
  const reissue = useReissueMemberVirtualAccount();
  const { data: linkData } = useGetMemberRegisterLink();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/members"] });

  const handleCreate = () => {
    const payload: Record<string, string | null> = {
      loginId: form.loginId, password: form.password, name: form.name,
      phone: form.phone, email: form.email || null,
      storeCode: form.storeCode || null, birthdate: form.birthdate || null,
    };
    create.mutate({ data: payload as unknown as Parameters<typeof create.mutate>[0]["data"] }, {
      onSuccess: () => {
        toast({ title: "회원 등록 완료" });
        setCreateOpen(false);
        setForm({ loginId: "", password: "", name: "", phone: "", email: "", storeCode: "", birthdate: "" });
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

  const handleReissue = (id: number) => {
    reissue.mutate({ id }, {
      onSuccess: () => { toast({ title: "가상계좌 재발급 완료" }); invalidate(); },
      onError: () => toast({ title: "재발급 실패", variant: "destructive" }),
    });
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    setDeleteLoading(true);
    try {
      await deleteMember(deleteId);
      toast({ title: "회원 삭제 완료" });
      invalidate();
    } catch {
      toast({ title: "삭제 실패", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeleteId(null);
    }
  };

  const handleCopyLink = () => {
    const url = linkData?.url ?? "";
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {
      toast({ title: "클립보드 복사 실패", description: "링크를 직접 복사해 주세요.", variant: "destructive" });
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">회원 관리</h1>
        <div className="flex gap-2">
          <a
            href={linkData?.url ? linkData.url.replace("/register/member", "/member/login") : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs h-9 px-3 rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">회원 로그인 페이지</span>
            <span className="sm:hidden">포털</span>
          </a>
          <Button variant="outline" onClick={handleCopyLink} className="gap-2 text-xs h-9">
            {linkCopied ? <CopyCheck className="h-4 w-4 text-green-400" /> : <Link className="h-4 w-4" />}
            <span className="hidden sm:inline">가입 링크 복사</span>
            <span className="sm:hidden">링크</span>
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-black hover:bg-primary/90 h-9">
            <Plus className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">회원 등록</span>
          </Button>
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="이름 / 아이디 / 전화번호 검색" className="pl-9" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Input placeholder="매장 코드" className="w-32" value={storeCode}
            onChange={(e) => { setStoreCode(e.target.value); setPage(1); }} />
        </CardContent>
      </Card>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : data?.items.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-10 text-center text-muted-foreground text-sm">회원이 없습니다</CardContent>
          </Card>
        ) : data?.items.map((m) => (
          <Card key={m.id} className="bg-card/50 border-border/50">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{m.loginId}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.phone}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={m.isActive} onCheckedChange={() => handleToggle(m.id, m.isActive)} />
                  <Badge variant="outline" className={`text-xs ${m.isActive ? "border-green-500/30 text-green-400" : "border-slate-500/30 text-slate-400"}`}>
                    {m.isActive ? "활성" : "비활"}
                  </Badge>
                </div>
              </div>
              {m.virtualAccountNumber ? (
                <div className="flex items-center gap-1.5 text-xs bg-muted/30 rounded px-2 py-1.5">
                  <CreditCard className="h-3 w-3 text-primary shrink-0" />
                  <span className="font-medium text-muted-foreground">{m.virtualAccountBank}</span>
                  <span className="font-mono text-foreground">{m.virtualAccountNumber}</span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5">가상계좌 미발급</div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                <div className="text-xs text-muted-foreground">
                  {m.storeName ?? m.storeCode ?? "—"} · {formatDate(m.createdAt)}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                    title="가상계좌 재발급" onClick={() => handleReissue(m.id)} disabled={reissue.isPending}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    title="회원 삭제" onClick={() => setDeleteId(m.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block bg-card/50 border-border/50">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">아이디</TableHead>
                  <TableHead className="whitespace-nowrap">이름</TableHead>
                  <TableHead className="whitespace-nowrap">전화번호</TableHead>
                  <TableHead className="whitespace-nowrap">생년월일</TableHead>
                  <TableHead className="whitespace-nowrap">이메일</TableHead>
                  <TableHead className="whitespace-nowrap">매장</TableHead>
                  <TableHead className="whitespace-nowrap">가상계좌 (은행 / 번호)</TableHead>
                  <TableHead className="whitespace-nowrap">상태</TableHead>
                  <TableHead className="whitespace-nowrap">가입일</TableHead>
                  <TableHead className="whitespace-nowrap">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((m) => (
                  <TableRow key={m.id} className="border-border/30">
                    <TableCell className="font-mono text-sm whitespace-nowrap">{m.loginId}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{m.name}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{m.phone}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{m.birthdate ?? "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{m.email ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="text-sm">{m.storeName ?? m.storeCode ?? "—"}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {m.virtualAccountNumber ? (
                        <div className="flex items-center gap-1 text-xs">
                          <CreditCard className="h-3 w-3 text-primary shrink-0" />
                          <span className="font-medium text-muted-foreground">{m.virtualAccountBank}</span>
                          <span className="font-mono text-foreground">{m.virtualAccountNumber}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">미발급</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Switch checked={m.isActive} onCheckedChange={() => handleToggle(m.id, m.isActive)} />
                        <Badge variant="outline" className={`text-xs ${m.isActive ? "border-green-500/30 text-green-400" : "border-slate-500/30 text-slate-400"}`}>
                          {m.isActive ? "활성" : "비활성"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(m.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                          title="가상계좌 재발급" onClick={() => handleReissue(m.id)} disabled={reissue.isPending}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                          title="회원 삭제" onClick={() => setDeleteId(m.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">회원이 없습니다</TableCell></TableRow>
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
        <DialogContent className="max-w-md mx-4 sm:mx-auto">
          <DialogHeader>
            <DialogTitle>회원 등록</DialogTitle>
            <DialogDescription>
              회원 기본정보를 입력해 신규 회원을 등록합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "아이디 *", key: "loginId", placeholder: "아이디" },
              { label: "비밀번호 *", key: "password", placeholder: "비밀번호", type: "password" },
              { label: "이름 *", key: "name", placeholder: "이름" },
              { label: "전화번호 *", key: "phone", placeholder: "010-0000-0000" },
              { label: "이메일", key: "email", placeholder: "선택입력" },
              { label: "매장 코드", key: "storeCode", placeholder: "선택입력" },
              { label: "생년월일", key: "birthdate", placeholder: "1990-01-01" },
            ].map((f) => (
              <div key={f.key} className={`space-y-1 ${f.key === "birthdate" ? "col-span-2" : ""}`}>
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

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent className="mx-4 sm:mx-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>회원 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 회원을 삭제하면 가상계좌도 함께 폐기됩니다. 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleteLoading} className="bg-red-600 hover:bg-red-700">
              {deleteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
