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
const CHILD_ROLE: Record<string, string | null> = {
  superadmin: "hq",
  hq: "distributor",
  distributor: "agency",
  agency: "store",
  store: null,
};

type UserItem = {
  id: number; loginId: string; name: string; role: string;
  permission: string; isActive: boolean; useOtp: boolean;
  parentId: number | null; parentName: string | null; createdAt: string;
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
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name, "ko"));
    nodes.forEach(n => sort(n.children));
  };
  sort(roots);
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
  myRole: string;
  onResetPw: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  onPermChange: (id: number, perm: string) => void;
  onToggle: (id: number, current: boolean) => void;
  onAddChild: (node: TreeNode) => void;
};

function NodeRow({
  node, depth, isLast, ancestorIsLast, myRole,
  onResetPw, onDelete, onPermChange, onToggle, onAddChild,
}: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const Icon = ROLE_ICONS[node.role] ?? Shield;
  const desc = countDescendants(node);
  const childRole = CHILD_ROLE[node.role];
  const canAddChild = !!childRole && (CREATABLE_ROLES[myRole] ?? []).includes(childRole);

  return (
    <>
      <div className="group flex items-center min-h-[44px] hover:bg-white/[0.03] border-b border-border/20 relative">
        {/* Tree indent lines */}
        <div className="flex shrink-0" style={{ width: depth * 20 }}>
          {Array.from({ length: depth }).map((_, i) => (
            <div key={i} className="w-5 shrink-0 relative flex justify-center">
              {!ancestorIsLast[i] && (
                <div className={`absolute top-0 bottom-0 left-1/2 border-l border-dashed ${ROLE_LINE_COLORS[node.role] ?? "border-border/30"} opacity-40`} />
              )}
            </div>
          ))}
          {depth > 0 && (
            <div className="w-5 shrink-0 relative flex items-center justify-center">
              <div className={`absolute top-0 ${isLast ? "bottom-1/2" : "bottom-0"} left-1/2 border-l border-dashed ${ROLE_LINE_COLORS[node.role] ?? "border-border/30"} opacity-40`} />
              <div className={`absolute top-1/2 left-1/2 w-2.5 border-t border-dashed ${ROLE_LINE_COLORS[node.role] ?? "border-border/30"} opacity-40`} />
            </div>
          )}
        </div>

        {/* Expand toggle */}
        <div className="w-6 shrink-0 flex items-center justify-center">
          {hasChildren ? (
            <button onClick={() => setExpanded(!expanded)}
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <div className="h-5 w-5" />
          )}
        </div>

        {/* Role icon + badge */}
        <div className="w-[110px] md:w-[130px] shrink-0 flex items-center gap-1 pr-2">
          <div className={`h-6 w-6 rounded flex items-center justify-center ${ROLE_COLORS[node.role] ?? ""} border shrink-0`}>
            <Icon className="h-3 w-3" />
          </div>
          <Badge variant="outline" className={`text-[10px] font-medium px-1.5 py-0 hidden sm:flex ${ROLE_COLORS[node.role] ?? ""}`}>
            {ROLE_LABELS[node.role] ?? node.role}
          </Badge>
        </div>

        {/* Name + loginId + child count */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pr-2">
          <span className="font-semibold text-sm text-foreground truncate">{node.name}</span>
          <span className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:inline">({node.loginId})</span>
          {desc > 0 && (
            <span className="text-[10px] text-muted-foreground/50 shrink-0 hidden md:inline">{desc}개 하위</span>
          )}
          {canAddChild && (
            <button
              onClick={() => onAddChild(node)}
              className="ml-0.5 h-5 w-5 rounded border border-dashed border-primary/40 flex items-center justify-center text-primary/60 hover:text-primary hover:border-primary hover:bg-primary/10 transition-colors shrink-0"
              title={`${ROLE_LABELS[childRole!]} 바로 추가`}
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Permission — hidden on mobile */}
        <div className="hidden md:block w-28 shrink-0 pr-3">
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
        <div className="w-14 md:w-16 shrink-0 flex items-center pr-2">
          <Switch checked={node.isActive} onCheckedChange={() => onToggle(node.id, node.isActive)}
            disabled={node.role === "superadmin"} className="scale-75 origin-left" />
          <span className={`text-[10px] ml-0.5 hidden sm:inline ${node.isActive ? "text-primary" : "text-muted-foreground"}`}>
            {node.isActive ? "활성" : "비활"}
          </span>
        </div>

        {/* OTP — hidden on small */}
        <div className="hidden sm:block w-12 shrink-0 pr-2">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${node.useOtp ? "border-primary/30 text-primary" : "border-border/30 text-muted-foreground"}`}>
            {node.useOtp ? "OTP" : "-"}
          </Badge>
        </div>

        {/* Actions — always visible on mobile, hover on desktop */}
        <div className="w-14 shrink-0 flex items-center gap-1 pr-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {node.role !== "superadmin" && (
            <>
              <button onClick={() => onResetPw(node.id)}
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                title="비밀번호 초기화">
                <KeyRound className="h-3 w-3" />
              </button>
              <button onClick={() => onDelete(node.id, node.name)}
                className="h-6 w-6 rounded flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="삭제">
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
          myRole={myRole}
          onResetPw={onResetPw}
          onDelete={onDelete}
          onPermChange={onPermChange}
          onToggle={onToggle}
          onAddChild={onAddChild}
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
type LockedParent = { id: number; name: string; loginId: string; role: string };

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [createOpen, setCreateOpen] = useState(false);
  const [lockedParent, setLockedParent] = useState<LockedParent | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });

  const myRole = user?.role ?? "store";
  const creatableRoles = CREATABLE_ROLES[myRole] ?? [];
  const requiredParentRole = REQUIRED_PARENT_ROLE[form.role] ?? null;
  const callerIsParent = !!requiredParentRole && myRole === requiredParentRole;
  const needsParentSelect = !!requiredParentRole && !callerIsParent && !lockedParent;

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

  const openCreate = () => {
    setLockedParent(null);
    setForm({ ...DEFAULT_FORM, role: creatableRoles[0] ?? "", permission: "admin" });
    setCreateOpen(true);
  };

  const openCreateForChild = (parentNode: TreeNode) => {
    const childRole = CHILD_ROLE[parentNode.role];
    if (!childRole) return;
    setLockedParent({ id: parentNode.id, name: parentNode.name, loginId: parentNode.loginId, role: parentNode.role });
    setForm({ ...DEFAULT_FORM, role: childRole, permission: "admin", parentId: parentNode.id });
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setLockedParent(null);
    setForm({ ...DEFAULT_FORM });
  };

  useEffect(() => {
    if (!lockedParent) {
      setForm(p => ({ ...p, parentId: null }));
    }
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
    if (lockedParent && requiredParentRole) {
      payload.parentId = lockedParent.id;
    } else if (needsParentSelect && form.parentId) {
      payload.parentId = form.parentId;
    }

    create.mutate({ data: payload as unknown as Parameters<typeof create.mutate>[0]["data"] }, {
      onSuccess: () => {
        toast({ title: "등록 완료" });
        closeCreate();
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">하부 조직 관리</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">전체 {totalCount}명 · 조직 계층 구조</p>
        </div>
        {creatableRoles.length > 0 && (
          <Button onClick={openCreate} className="bg-primary text-black hover:bg-primary/90 shrink-0">
            <Plus className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">조직원 등록</span>
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
        {/* Column header */}
        <div className="flex items-center h-9 border-b border-border/50 bg-muted/20 text-xs text-muted-foreground font-medium px-2 overflow-x-auto">
          <div style={{ width: 26 }} className="shrink-0" />
          <div className="w-[110px] md:w-[130px] shrink-0">역할</div>
          <div className="flex-1 min-w-[120px]">이름 (아이디)</div>
          <div className="hidden md:block w-28 shrink-0">권한</div>
          <div className="w-14 md:w-16 shrink-0">상태</div>
          <div className="hidden sm:block w-12 shrink-0">OTP</div>
          <div className="w-14 shrink-0">처리</div>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">조직원이 없습니다</div>
          ) : (
            <div className="min-w-[360px]">
              {tree.map((node, idx) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  isLast={idx === tree.length - 1}
                  ancestorIsLast={[]}
                  myRole={myRole}
                  onResetPw={(id) => { setResetId(id); setNewPassword(""); }}
                  onDelete={handleDelete}
                  onPermChange={handlePermChange}
                  onToggle={handleToggle}
                  onAddChild={openCreateForChild}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetId} onOpenChange={(o) => !o && setResetId(null)}>
        <DialogContent className="mx-4 sm:mx-auto">
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
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeCreate(); }}>
        <DialogContent className="max-w-md mx-4 sm:mx-auto">
          <DialogHeader>
            <DialogTitle>
              {lockedParent
                ? `${ROLE_LABELS[CHILD_ROLE[lockedParent.role] ?? ""] ?? ""} 등록`
                : "조직원 등록"}
            </DialogTitle>
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
                <Input value={form.loginId}
                  onChange={(e) => setForm(p => ({ ...p, loginId: e.target.value.replace(/\s/g, "") }))}
                  placeholder="영문/숫자" />
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
                {lockedParent ? (
                  <div className={`h-10 px-3 rounded-md border flex items-center text-sm ${ROLE_COLORS[form.role] ?? "border-border/40"}`}>
                    {ROLE_LABELS[form.role]}
                  </div>
                ) : (
                  <Select value={form.role} onValueChange={(v) => setForm(p => ({ ...p, role: v, parentId: null }))}>
                    <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      {creatableRoles.map(r => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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

            {lockedParent && (
              <div className="rounded-md border px-3 py-2.5 flex items-center gap-2">
                <div className={`h-6 w-6 rounded border flex items-center justify-center shrink-0 ${ROLE_COLORS[lockedParent.role] ?? ""}`}>
                  {React.createElement(ROLE_ICONS[lockedParent.role] ?? Shield, { className: "h-3 w-3" })}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[lockedParent.role]} (상위 조직)</p>
                  <p className="text-sm font-medium truncate">{lockedParent.name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{lockedParent.loginId}</p>
                </div>
              </div>
            )}

            {needsParentSelect && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  상위 {ROLE_LABELS[requiredParentRole!]} 선택 *
                </Label>
                <Select
                  value={form.parentId ? String(form.parentId) : ""}
                  onValueChange={(v) => setForm(p => ({ ...p, parentId: Number(v) }))}
                >
                  <SelectTrigger><SelectValue placeholder="선택..." /></SelectTrigger>
                  <SelectContent>
                    {(parentList?.items ?? []).map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name} ({u.loginId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>취소</Button>
            <Button onClick={handleCreate} disabled={create.isPending} className="bg-primary text-black hover:bg-primary/90">
              {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
