import React, { useState, useEffect, useMemo } from "react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserPassword,
  useUpdateUserPermission,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, KeyRound, Trash2, ChevronDown, ChevronRight as ChevronRightIcon,
  Building2, Network, Store, Shield, Users as UsersIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "슈퍼관리자", hq: "본사", distributor: "총판", agency: "대리점", store: "매장",
};
const ROLE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/40 text-purple-400 bg-purple-500/10",
  hq:         "border-blue-500/40 text-blue-400 bg-blue-500/10",
  distributor:"border-green-500/40 text-green-400 bg-green-500/10",
  agency:     "border-orange-500/40 text-orange-400 bg-orange-500/10",
  store:      "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
};
const ROLE_LINE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/30",
  hq:         "border-blue-500/30",
  distributor:"border-green-500/30",
  agency:     "border-orange-500/30",
  store:      "border-yellow-500/30",
};
const ROLE_ICONS: Record<string, React.ElementType> = {
  superadmin: Shield,
  hq: Building2,
  distributor: Network,
  agency: UsersIcon,
  store: Store,
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
  hq: null, distributor: "hq", agency: "distributor", store: "agency",
};

type UserItem = {
  id: number;
  loginId: string;
  name: string;
  role: string;
  permission: string;
  isActive: boolean;
  useOtp: boolean;
  parentId: number | null;
  parentName: string | null;
  createdAt: string;
};

type TreeNode = UserItem & { children: TreeNode[] };

function buildTree(users: UserItem[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  users.forEach(u => map.set(u.id, { ...u, children: [] }));
  const roots: TreeNode[] = [];
  users.forEach(u => {
    const node = map.get(u.id)!;
    if (u.parentId && map.has(u.parentId)) {
      map.get(u.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const roleOrder = ["superadmin", "hq", "distributor", "agency", "store"];
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name, "ko"));
    nodes.forEach(n => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}

type NodeRowProps = {
  node: TreeNode;
  depth: number;
  isLast: boolean;
  ancestorIsLast: boolean[];
  onResetPw: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  onPermChange: (id: number, perm: string) => void;
  onToggle: (id: number, current: boolean) => void;
};

function NodeRow({
  node, depth, isLast, ancestorIsLast, onResetPw, onDelete, onPermChange, onToggle,
}: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const Icon = ROLE_ICONS[node.role] ?? Shield;
  const desc = countDescendants(node);

  return (
    <>
      <div className="group flex items-center min-h-[44px] hover:bg-white/[0.03] border-b border-border/20 relative">
        {/* Tree lines */}
        <div className="flex shrink-0" style={{ width: depth * 24 + (depth > 0 ? 0 : 0) }}>
          {Array.from({ length: depth }).map((_, i) => (
            <div
              key={i}
              className={`w-6 shrink-0 relative flex justify-center`}
            >
              {!ancestorIsLast[i] && (
                <div className={`absolute top-0 bottom-0 left-1/2 border-l border-dashed ${ROLE_LINE_COLORS[node.role] ?? "border-border/30"} opacity-40`} />
              )}
            </div>
          ))}
          {depth > 0 && (
            <div className="w-6 shrink-0 relative flex items-center justify-center">
              <div className={`absolute top-0 ${isLast ? "bottom-1/2" : "bottom-0"} left-1/2 border-l border-dashed ${ROLE_LINE_COLORS[node.role] ?? "border-border/30"} opacity-40`} />
              <div className={`absolute top-1/2 left-1/2 w-3 border-t border-dashed ${ROLE_LINE_COLORS[node.role] ?? "border-border/30"} opacity-40`} />
            </div>
          )}
        </div>

        {/* Expand toggle */}
        <div className="w-6 shrink-0 flex items-center justify-center">
          {hasChildren ? (
            <button onClick={() => setExpanded(!expanded)}
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
              {expanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRightIcon className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <div className="h-5 w-5" />
          )}
        </div>

        {/* Role icon + badge */}
        <div className="w-[130px] shrink-0 flex items-center gap-1.5 pr-2">
          <div className={`h-6 w-6 rounded flex items-center justify-center ${ROLE_COLORS[node.role] ?? ""} border shrink-0`}>
            <Icon className="h-3 w-3" />
          </div>
          <Badge variant="outline" className={`text-[10px] font-medium px-1.5 py-0 ${ROLE_COLORS[node.role] ?? ""}`}>
            {ROLE_LABELS[node.role] ?? node.role}
          </Badge>
        </div>

        {/* Name + loginId */}
        <div className="flex-1 min-w-0 flex items-center gap-2 pr-3">
          <span className="font-semibold text-sm text-foreground truncate">{node.name}</span>
          <span className="text-xs text-muted-foreground font-mono shrink-0">({node.loginId})</span>
          {desc > 0 && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0">{desc}개 하위</span>
          )}
        </div>

        {/* Permission */}
        <div className="w-28 shrink-0 pr-3">
          {node.role !== "superadmin" ? (
            <Select value={node.permission} onValueChange={(v) => onPermChange(node.id, v)}>
              <SelectTrigger className="h-7 text-xs border-border/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="readonly">읽기전용</SelectItem>
                <SelectItem value="admin">관리자</SelectItem>
                <SelectItem value="finance">재무</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">{PERM_LABELS[node.permission]}</span>
          )}
        </div>

        {/* Active */}
        <div className="w-16 shrink-0 flex items-center pr-3">
          <Switch
            checked={node.isActive}
            onCheckedChange={() => onToggle(node.id, node.isActive)}
            disabled={node.role === "superadmin"}
            className="scale-75 origin-left"
          />
          <span className={`text-[10px] ml-1 ${node.isActive ? "text-primary" : "text-muted-foreground"}`}>
            {node.isActive ? "활성" : "비활"}
          </span>
        </div>

        {/* OTP */}
        <div className="w-14 shrink-0 pr-3">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${node.useOtp ? "border-primary/30 text-primary" : "border-border/30 text-muted-foreground"}`}>
            {node.useOtp ? "OTP" : "-"}
          </Badge>
        </div>

        {/* Actions */}
        <div className="w-16 shrink-0 flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 transition-opacity">
          {node.role !== "superadmin" && (
            <>
              <button
                onClick={() => onResetPw(node.id)}
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                title="비밀번호 초기화"
              >
                <KeyRound className="h-3 w-3" />
              </button>
              <button
                onClick={() => onDelete(node.id, node.name)}
                className="h-6 w-6 rounded flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && node.children.map((child, idx) => (
        <NodeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          isLast={idx === node.children.length - 1}
          ancestorIsLast={[...ancestorIsLast, isLast]}
          onResetPw={onResetPw}
          onDelete={onDelete}
          onPermChange={onPermChange}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

type FormState = {
  loginId: string; password: string; name: string;
  role: string; permission: string; parentId: number | null;
};
const DEFAULT_FORM: FormState = {
  loginId: "", password: "", name: "", role: "", permission: "admin", parentId: null,
};

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [createOpen, setCreateOpen] = useState(false);
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });

  const myRole = user?.role ?? "store";
  const creatableRoles = CREATABLE_ROLES[myRole] ?? [];
  const requiredParentRole = REQUIRED_PARENT_ROLE[form.role] ?? null;
  const callerIsParent = !!requiredParentRole && myRole === requiredParentRole;
  const needsParentSelect = !!requiredParentRole && !callerIsParent;

  const { data, isLoading, refetch } = useListUsers({ limit: 500 });

  const { data: parentList } = useListUsers(
    needsParentSelect && requiredParentRole
      ? { role: requiredParentRole, limit: 100 }
      : { role: "hq", limit: 1 },
  );

  const tree = useMemo(() => buildTree((data?.items ?? []) as UserItem[]), [data]);

  const create = useCreateUser();
  const del = useDeleteUser();
  const resetPw = useResetUserPassword();
  const updatePerm = useUpdateUserPermission();
  const updateUser = useUpdateUser();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["/api/users"] });
    void refetch();
  };

  useEffect(() => {
    if (creatableRoles.length > 0) {
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
      toast({ title: `상위 ${ROLE_LABELS[requiredParentRole!]}를 선택해주세요`, variant: "destructive" }); return;
    }
    const payload: Record<string, unknown> = {
      loginId: form.loginId.trim(), password: form.password,
      name: form.name.trim(), role: form.role, permission: form.permission,
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

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`"${name}" 계정을 삭제하시겠습니까?\n하위 계정은 삭제되지 않습니다.`)) return;
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
      onSuccess: () => { toast({ title: !current ? "활성화 완료" : "비활성화 완료" }); invalidate(); },
      onError: () => toast({ title: "상태 변경 실패", variant: "destructive" }),
    });
  };

  const totalCount = data?.items.length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">하부 조직 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">전체 {totalCount}명 · 조직 계층 구조</p>
        </div>
        {creatableRoles.length > 0 && (
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-black hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />조직원 등록
          </Button>
        )}
      </div>

      {/* Tree */}
      <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
        {/* Column header */}
        <div className="flex items-center h-9 border-b border-border/50 bg-muted/20 text-xs text-muted-foreground font-medium px-3">
          <div style={{ width: 6 + 24 }} className="shrink-0" />
          <div className="w-[130px] shrink-0">역할</div>
          <div className="flex-1 min-w-0">이름 (아이디)</div>
          <div className="w-28 shrink-0">권한</div>
          <div className="w-16 shrink-0">상태</div>
          <div className="w-14 shrink-0">OTP</div>
          <div className="w-16 shrink-0">처리</div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">조직원이 없습니다</div>
        ) : (
          <div>
            {tree.map((node, idx) => (
              <NodeRow
                key={node.id}
                node={node}
                depth={0}
                isLast={idx === tree.length - 1}
                ancestorIsLast={[]}
                onResetPw={(id) => { setResetId(id); setNewPassword(""); }}
                onDelete={handleDelete}
                onPermChange={handlePermChange}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>

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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setForm({ ...DEFAULT_FORM }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>조직원 등록</DialogTitle>
            {form.role && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 flex-wrap">
                <span>계층 위치:</span>
                {requiredParentRole && (
                  <>
                    <Badge variant="outline" className={`text-xs ${ROLE_COLORS[requiredParentRole] ?? ""}`}>
                      {ROLE_LABELS[requiredParentRole]}
                    </Badge>
                    <ChevronRightIcon className="h-3 w-3" />
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
                <Input type="password" value={form.password}
                  onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))} />
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

            {callerIsParent && (
              <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                상위: <span className="text-foreground font-medium">{user?.name} ({user?.loginId})</span> — 자동 지정
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setForm({ ...DEFAULT_FORM }); }}>취소</Button>
            <Button onClick={handleCreate} disabled={create.isPending} className="bg-primary text-black hover:bg-primary/90">
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
