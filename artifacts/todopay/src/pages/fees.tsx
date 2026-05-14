import React, { useState } from "react";
import {
  useListFees,
  useCreateFeeConfig,
  useUpdateFeeConfig,
} from "@workspace/api-client-react";
import type { FeeListItem } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Pencil, Check, X, AlertCircle,
  ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

// ── 상수 ──────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  hq: "본사", distributor: "총판", agency: "대리점", store: "매장",
};

const ROLE_BADGE: Record<string, string> = {
  store:       "bg-yellow-500/15 border-yellow-500/40 text-yellow-300",
  agency:      "bg-orange-500/15 border-orange-500/40 text-orange-300",
  distributor: "bg-green-500/15  border-green-500/40  text-green-300",
  hq:          "bg-blue-500/15   border-blue-500/40   text-blue-300",
};

const INDENT_PX = 20;

function fmt(n: number) { return n.toLocaleString("ko-KR"); }

// ── 인라인 편집 폼 ─────────────────────────────────────────
function EditForm({
  item,
  onSave,
  onCancel,
  isSaving,
  depth,
}: {
  item: FeeListItem;
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  onCancel: () => void;
  isSaving: boolean;
  depth: number;
}) {
  const isStore = item.role === "store";
  const ext = item as typeof item & { usageFeeRate?: number | null; parentUsageFeeRate?: number | null };
  const parRate = ext.parentUsageFeeRate ?? null;

  const [vals, setVals] = useState({
    deposit:    String(item.depositFee    ?? 0),
    withdrawal: String(item.withdrawalFee ?? 0),
    rate:       String(ext.usageFeeRate   ?? 0),
  });

  const rateNum = parseFloat(vals.rate);
  const profitPreview = !isNaN(rateNum) && parRate != null
    ? Math.round((rateNum - parRate) * 100) / 100 : null;
  const rateInvalid = !isNaN(rateNum) && parRate != null && rateNum < parRate;

  const save = () => {
    const d = isStore ? parseInt(vals.deposit, 10) : 0;
    const w = isStore ? parseInt(vals.withdrawal, 10) : 0;
    const r = parseFloat(vals.rate);
    if (isNaN(r) || r < 0 || r > 100 || rateInvalid) return;
    if (isStore && (isNaN(d) || d < 0 || isNaN(w) || w < 0)) return;
    onSave(item, d, w, r);
  };

  return (
    <div
      className="py-3 pr-4 bg-white/[0.04] border-b border-border/30"
      style={{ paddingLeft: depth * INDENT_PX + 12 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${ROLE_BADGE[item.role] ?? ""}`}>
          {ROLE_LABELS[item.role] ?? item.role}
        </Badge>
        <span className="font-semibold text-sm">{item.userName}</span>
        <span className="text-xs text-muted-foreground font-mono">({item.userLoginId})</span>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={save}
            disabled={isSaving || rateInvalid}
            className="h-7 w-7 rounded flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onCancel}
            className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={`grid gap-3 ${isStore ? "grid-cols-3" : "grid-cols-1 max-w-[200px]"}`}>
        {isStore && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">입금수수료/건</label>
              <div className="flex items-center gap-1">
                <Input type="number" step="1" min="0" value={vals.deposit} autoFocus
                  onChange={e => setVals(p => ({ ...p, deposit: e.target.value }))}
                  className="h-8 text-sm text-right" />
                <span className="text-xs text-muted-foreground shrink-0">원</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">출금수수료/건</label>
              <div className="flex items-center gap-1">
                <Input type="number" step="1" min="0" value={vals.withdrawal}
                  onChange={e => setVals(p => ({ ...p, withdrawal: e.target.value }))}
                  className="h-8 text-sm text-right" />
                <span className="text-xs text-muted-foreground shrink-0">원</span>
              </div>
            </div>
          </>
        )}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            {isStore ? "이용수수료율" : `전달률${parRate != null ? ` (최소 ${parRate}%)` : ""}`}
          </label>
          <div className="flex items-center gap-1">
            <Input
              type="number" step="0.01" min={parRate ?? 0} max="100"
              value={vals.rate} autoFocus={!isStore}
              onChange={e => {
                const n = parseFloat(e.target.value);
                if (parRate != null && !isNaN(n) && n < parRate) return;
                setVals(p => ({ ...p, rate: e.target.value }));
              }}
              className={`h-8 text-sm text-right ${rateInvalid ? "border-red-500" : ""}`}
            />
            <span className="text-xs text-muted-foreground shrink-0">%</span>
          </div>
        </div>
      </div>

      {!isStore && profitPreview != null && profitPreview > 0 && (
        <p className="text-xs mt-2 text-emerald-400">
          수익 {profitPreview}% <span className="text-muted-foreground">(전달{vals.rate}% − 상위{parRate}%)</span>
        </p>
      )}
      {rateInvalid && (
        <p className="text-xs mt-2 text-red-400">최소 {parRate}% 이상 설정 필요</p>
      )}
    </div>
  );
}

// ── 자식 노드 목록 (마운트될 때만 쿼리 실행) ─────────────────
function FeeTreeChildren({
  parentId,
  depth,
  defaultExpanded,
  onSave,
  savingId,
}: {
  parentId: number;
  depth: number;
  defaultExpanded: boolean;
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
}) {
  const { data, isLoading } = useListFees({ parentId });

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 py-2 text-xs text-muted-foreground border-b border-border/15"
        style={{ paddingLeft: depth * INDENT_PX + 12 }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>불러오는 중...</span>
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div
        className="py-2 text-xs text-muted-foreground border-b border-border/15"
        style={{ paddingLeft: depth * INDENT_PX + 12 }}
      >
        하위 계정 없음
      </div>
    );
  }

  return (
    <>
      {data.map(child => (
        <FeeTreeNode
          key={child.userId}
          item={child}
          depth={depth}
          defaultExpanded={defaultExpanded}
          onSave={onSave}
          savingId={savingId}
        />
      ))}
    </>
  );
}

// ── 트리 노드 행 ────────────────────────────────────────────
function FeeTreeNode({
  item,
  depth,
  defaultExpanded,
  onSave,
  savingId,
}: {
  item: FeeListItem;
  depth: number;
  defaultExpanded: boolean;
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
}) {
  const isStore = item.role === "store";
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);

  const ext = item as typeof item & { usageFeeRate?: number | null; parentUsageFeeRate?: number | null };
  const myRate  = ext.usageFeeRate       ?? null;
  const parRate = ext.parentUsageFeeRate ?? null;
  const hasConfig = item.feeConfigId != null;
  const isSaving  = savingId === item.userId;

  return (
    <>
      {/* ── 편집 폼 (행 대체) ── */}
      {editing ? (
        <EditForm
          item={item}
          depth={depth}
          onSave={(it, d, w, r) => { onSave(it, d, w, r); setEditing(false); }}
          onCancel={() => setEditing(false)}
          isSaving={isSaving}
        />
      ) : (
        /* ── 일반 행 ── */
        <div
          className="group flex items-center gap-2 py-2.5 pr-4 border-b border-border/15 hover:bg-white/[0.02]"
          style={{ paddingLeft: depth * INDENT_PX + 12 }}
        >
          {/* 접기/펼치기 */}
          {!isStore ? (
            <button
              onClick={() => setExpanded(v => !v)}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/10 shrink-0"
            >
              {expanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-5 w-5 flex items-center justify-center shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400/60" />
            </span>
          )}

          {/* 역할 + 이름 */}
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${ROLE_BADGE[item.role] ?? ""}`}>
            {ROLE_LABELS[item.role] ?? item.role}
          </Badge>
          <span className="font-medium text-sm truncate">{item.userName}</span>
          <span className="text-xs text-muted-foreground font-mono hidden sm:inline">({item.userLoginId})</span>

          {/* 수수료 표시 */}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {isStore ? (
              hasConfig ? (
                <>
                  <div className="text-right hidden md:block">
                    <div className="text-[10px] text-muted-foreground">입금/건</div>
                    <div className="text-xs font-mono">{fmt(item.depositFee ?? 0)}원</div>
                  </div>
                  <div className="text-right hidden md:block">
                    <div className="text-[10px] text-muted-foreground">출금/건</div>
                    <div className="text-xs font-mono">{fmt(item.withdrawalFee ?? 0)}원</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground">이용수수료율</div>
                    <div className="text-base font-bold font-mono text-yellow-400">{myRate ?? 0}%</div>
                  </div>
                </>
              ) : (
                <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-400">미설정</Badge>
              )
            ) : (
              hasConfig ? (
                <>
                  {myRate != null && parRate != null && (
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] text-muted-foreground">수익률</div>
                      <div className="text-sm font-bold font-mono text-emerald-400">
                        {myRate - parRate > 0 ? `+${Math.round((myRate - parRate) * 100) / 100}%` : "0%"}
                      </div>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground">전달률</div>
                    <div className="text-sm font-mono text-muted-foreground">{myRate ?? 0}%</div>
                  </div>
                </>
              ) : (
                <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-400">미설정</Badge>
              )
            )}

            {/* 편집 버튼 */}
            <button
              onClick={() => setEditing(true)}
              className={[
                "h-7 px-2 rounded flex items-center gap-1 text-xs transition-colors shrink-0",
                hasConfig
                  ? "text-muted-foreground hover:text-foreground hover:bg-white/10 opacity-0 group-hover:opacity-100"
                  : "border border-primary/40 text-primary hover:bg-primary/10",
              ].join(" ")}
            >
              <Pencil className="h-3 w-3" />
              <span className="hidden sm:inline">{hasConfig ? "수정" : "설정"}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── 자식 노드 (expanded 일 때만 마운트) ── */}
      {!isStore && expanded && (
        <FeeTreeChildren
          parentId={item.userId}
          depth={depth + 1}
          defaultExpanded={depth < 1}
          onSave={onSave}
          savingId={savingId}
        />
      )}
    </>
  );
}

// ── 루트 트리 ──────────────────────────────────────────────
function FeeTree({
  myRole,
  onSave,
  savingId,
}: {
  myRole: string;
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
}) {
  const params = myRole === "superadmin" ? { role: "hq" } : {};
  const { data, isLoading } = useListFees(params);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items = data ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <AlertCircle className="h-7 w-7 opacity-30" />
        <p className="text-sm">하위 계정이 없습니다</p>
      </div>
    );
  }

  return (
    <>
      {items.map(item => (
        <FeeTreeNode
          key={item.userId}
          item={item}
          depth={0}
          defaultExpanded={true}
          onSave={onSave}
          savingId={savingId}
        />
      ))}
    </>
  );
}

// ── 메인 ──────────────────────────────────────────────────
export default function Fees() {
  const { toast }   = useToast();
  const qc          = useQueryClient();
  const { user }    = useAuth();
  const create      = useCreateFeeConfig();
  const update      = useUpdateFeeConfig();
  const [savingId, setSavingId] = useState<number | null>(null);

  const myRole = user?.role ?? "store";

  if (myRole === "store") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">수수료 설정</h1>
        <Card className="bg-card/50">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <AlertCircle className="h-7 w-7 opacity-40" />
            <p className="text-sm">설정 가능한 하위 계정이 없습니다</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/fees"] });

  const handleSave = (item: FeeListItem, deposit: number, withdrawal: number, rate: number) => {
    setSavingId(item.userId);
    const payload = { depositFee: deposit, withdrawalFee: withdrawal, usageFeeRate: rate };
    const done = (msg: string) => () => { toast({ title: msg }); invalidate(); setSavingId(null); };
    const fail = (e: unknown) => {
      toast({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "오류 발생", variant: "destructive" });
      setSavingId(null);
    };
    if (item.feeConfigId != null) {
      update.mutate({ id: item.feeConfigId, data: payload }, { onSuccess: done("수정 완료"), onError: fail });
    } else {
      create.mutate({ data: { userId: item.userId, ...payload } }, { onSuccess: done("설정 완료"), onError: fail });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          계층 트리로 모든 계정의 수수료를 한눈에 확인하고 수정합니다.
        </p>
      </div>

      <Card className="bg-card/50 border-border/50">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-blue-500/60" /> 본사
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-green-500/60" /> 총판
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-orange-500/60" /> 대리점
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-yellow-500/60" /> 매장
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground hidden md:flex">
            <ChevronsUpDown className="h-3.5 w-3.5" />
            <span>행 클릭 시 접기/펼치기</span>
          </div>
        </div>

        <CardContent className="p-0">
          <FeeTree myRole={myRole} onSave={handleSave} savingId={savingId} />
        </CardContent>
      </Card>
    </div>
  );
}
