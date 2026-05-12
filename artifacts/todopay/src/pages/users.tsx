import React, { useState, useEffect } from "react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserPassword,
  useUpdateUserPermission,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { formatDate } from "@/lib/format";
import { Loader2, Search, Plus, KeyRound, Trash2, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "슈퍼관리자", hq: "본사", distributor: "총판", agency: "대리점", store: "매장",
};
const ROLE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/30 text-purple-400",
  hq: "border-blue-500/30 text-blue-400",
  distributor: "border-green-500/30 text-green-400",
  agency: "border-orange-500/30 text-orange-400",
  store: "border-yellow-500/30 text-yellow-400",
};
const PERM_LABELS: Record<string, string> = { readonly: "읽기전용", admin: "관리자", finance: "재무" };

const CREATABLE_ROLES: Record<string, string[]> = {
  superadmin: ["hq", "distributor", "agency", "store"],
  hq:         ["distributor", "agency", "store"],
  distributor:["agency", "store"],
  agency:     ["store"],
  store:      [],
};

const REQUIRED_PARENT_ROLE: Record<string, string | null> = {
  hq: null,
  distributor: "hq",
  agency: "distributor",
  store: "agency",
};

const FILTER_ROLES = ["hq", "distributor", "agency", "store"];

type FormState = {
  loginId: string;
  password: string;
  name: string;
  role: string;
  permission: string;
  parentId: number | null;
};

const DEFAULT_FORM: FormState = {
  loginId: "", password: "", name: "", role: "", permission: "admin", parentId: null,
};

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });

  const myRole = user?.role ?? "store";
  const creatableRoles = CREATABLE_ROLES[myRole] ?? [];
  const requiredParentRole = REQUIRED_PARENT_ROLE[form.role] ?? null;
  const callerIsParent = !!requiredParentRole && myRole === requiredParentRole;
  const needsParentSelect = !!requiredParentRole && !callerIsParent;

  const { data, isLoading } = useListUsers({
    search: search || undefined,
    role: filterRole === "all" ? undefined : filterRole,
    page,
    limit: 20,
  });

  const { data: parentList } = useListUsers(
    needsParentSelect && requiredParentRole
      ? { role: requiredParentRole, limit: 100 }
      : { role: "hq", limit: 1 },
  );

  const create = useCreateUser();
  const del = useDeleteUser();
  const resetPw = useResetUserPassword();
  const updatePerm = useUpdateUserPermission();
  const updateUser = useUpdateUser();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/users"] });

  useEffect(() => {
    if (creatableRoles.length > 0 && !creatableRoles.includes(form.role)) {
      setForm(p => ({ ...p, role: creatableRoles[0], parentId: null }));
    }
  }, [createOpen]);

  useEffect(() => {
    setForm(p => ({ ...p, parentId: null }));
  }, [form.role]);

  const handleCreate = () => {
    if (!form.loginId.trim()) { toast({ title: "아이디를 입력해주세요", variant: "destructive" }); return; }
    if (!form.password.trim()) { toast({ title: "비밀번호를 입력해주세요", variant: "destructive" }); return; }
    if (!form.name.trim()) { toast({ title: "이름을 입력해주세요", variant: "destructive" }); return; }
    if (needsParentSelect && !form.parentId) {
      toast({ title: `상위 ${ROLE_LABELS[requiredParentRole!]}를 선택해주세요`, variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      loginId: form.loginId.trim(),
      password: form.password,
      name: form.name.trim(),
      role: form.role,
      permission: form.permission,
    };
    if (needsParentSelect && form.parentId) payload.parentId = form.parentId;

    create.mutate({ data: payload as Parameters<typeof create.mutate>[0]["data"] }, {
      onSuccess: () => {
        toast({ title: "등록 완료" });
        setCreateOpen(false);
        setForm({ ...DEFAULT_FORM });
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "등록 실패";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("유저를 삭제하시겠습니까?")) return;
    del.mutate({ id }, {
      onSuccess: () => { toast({ title: "삭제 완료" }); invalidate(); },
      onError: () => toast({ title: "삭제 실패", variant: "destructive" }),
    });
  };

  const handleResetPw = () => {
    if (!resetId) return;
    resetPw.mutate({ id: resetId, data: { newPassword } }, {
      onSuccess: () => { toast({ title: "비밀번호 초기화 완료" }); setResetId(null); setNewPassword(""); },
      onError: () => toast({ title: "초기화 실패", variant: "destructive" }),
    });
  };

  const handlePermChange = (id: number, permission: string) => {
    updatePerm.mutate({ id, data: { permission } }, {
      onSuccess: () => { toast({ title: "권한 변경 완료" }); invalidate(); },
      onError: () => toast({ title: "권한 변경 실패", variant: "destructive" }),
    });
  };

  const handleToggle = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => { toast({ title: !current ? "활성화" : "비활성화" }); invalidate(); },
      onError: () => toast({ title: "상태 변경 실패", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">유저 관리</h1>
        {creatableRoles.length > 0 && (
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-black hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />유저 등록
          </Button>
        )}
      </div>

      {/* Hierarchy info */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
        {["superadmin","hq","distributor","agency","store"].map((r, i) => (
          <React.Fragment key={r}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className={`px-2 py-0.5 rounded-full border ${ROLE_COLORS[r] ?? ""} ${r === myRole ? "font-bold" : "opacity-60"}`}>
              {ROLE_LABELS[r]}
            </span>
          </React.Fragment>
        ))}
        <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
        <span className="px-2 py-0.5 rounded-full border border-slate-500/30 text-slate-400 opacity-60">일반회원</span>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="이름 / 아이디 검색" className="pl-9" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={filterRole} onValueChange={(v) => { setFilterRole(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 역할</SelectItem>
              {FILTER_ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
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
                  <TableHead>역할</TableHead>
                  <TableHead>권한</TableHead>
                  <TableHead>상위</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>OTP</TableHead>
                  <TableHead>등록일</TableHead>
                  <TableHead>처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((u) => (
                  <TableRow key={u.id} className="border-border/30">
                    <TableCell className="font-mono text-sm">{u.loginId}</TableCell>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${ROLE_COLORS[u.role] ?? ""}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.role !== "superadmin" ? (
                        <Select value={u.permission} onValueChange={(v) => handlePermChange(u.id, v)}>
                          <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="readonly">읽기전용</SelectItem>
                            <SelectItem value="admin">관리자</SelectItem>
                            <SelectItem value="finance">재무</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">{PERM_LABELS[u.permission]}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.parentName ?? "-"}</TableCell>
                    <TableCell>
                      <Switch checked={u.isActive} onCheckedChange={() => handleToggle(u.id, u.isActive)}
                        disabled={u.role === "superadmin"} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${u.useOtp ? "border-primary/30 text-primary" : "border-slate-500/30 text-slate-400"}`}>
                        {u.useOtp ? "사용" : "미사용"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(u.createdAt)}</TableCell>
                    <TableCell>
                      {u.role !== "superadmin" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setResetId(u.id); setNewPassword(""); }} title="비밀번호 초기화">
                            <KeyRound className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline"
                            className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                            onClick={() => handleDelete(u.id)} title="삭제">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">유저가 없습니다</TableCell>
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

      {/* Reset Password Dialog */}
      <Dialog open={!!resetId} onOpenChange={(o) => !o && setResetId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>비밀번호 초기화</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">새 비밀번호</Label>
            <Input type="password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} placeholder="새 비밀번호 입력" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetId(null)}>취소</Button>
            <Button onClick={handleResetPw} disabled={!newPassword.trim() || resetPw.isPending}>
              {resetPw.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}초기화
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setForm({ ...DEFAULT_FORM }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>유저 등록</DialogTitle>
            {form.role && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 flex-wrap">
                <span>계층:</span>
                {requiredParentRole && (
                  <>
                    <Badge variant="outline" className={`text-xs ${ROLE_COLORS[requiredParentRole] ?? ""}`}>
                      {ROLE_LABELS[requiredParentRole]}
                    </Badge>
                    <ChevronRight className="h-3 w-3" />
                  </>
                )}
                <Badge variant="outline" className={`text-xs ${ROLE_COLORS[form.role] ?? ""}`}>
                  {ROLE_LABELS[form.role]}
                </Badge>
              </div>
            )}
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">아이디 *</Label>
                <Input
                  value={form.loginId}
                  onChange={(e) => setForm(p => ({ ...p, loginId: e.target.value.replace(/\s/g, "") }))}
                  placeholder="영문/숫자"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">비밀번호 *</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">이름 *</Label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">역할 *</Label>
                <Select value={form.role} onValueChange={(v) => setForm(p => ({ ...p, role: v, parentId: null }))}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {creatableRoles.map(r => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">권한</Label>
                <Select value={form.permission} onValueChange={(v) => setForm(p => ({ ...p, permission: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="readonly">읽기전용</SelectItem>
                    <SelectItem value="admin">관리자</SelectItem>
                    <SelectItem value="finance">재무</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Parent selection — only when caller is not the direct parent */}
            {needsParentSelect && requiredParentRole && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  상위 {ROLE_LABELS[requiredParentRole]} 선택 *
                </Label>
                <Select
                  value={form.parentId?.toString() ?? ""}
                  onValueChange={(v) => setForm(p => ({ ...p, parentId: parseInt(v, 10) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`${ROLE_LABELS[requiredParentRole]} 선택`} />
                  </SelectTrigger>
                  <SelectContent>
                    {parentList?.items.map(p => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name} <span className="text-muted-foreground ml-1">({p.loginId})</span>
                      </SelectItem>
                    ))}
                    {!parentList?.items.length && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        등록된 {ROLE_LABELS[requiredParentRole]}이 없습니다
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Auto-assigned parent info */}
            {callerIsParent && (
              <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                상위: <span className="text-foreground font-medium">{user?.name} ({user?.loginId})</span> — 자동 지정
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setForm({ ...DEFAULT_FORM }); }}>취소</Button>
            <Button
              onClick={handleCreate}
              disabled={create.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
