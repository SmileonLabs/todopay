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
import { Loader2, Pencil, Check, X, AlertCircle, ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_LABELS: Record<string, string> = {
  hq: "본사", distributor: "총판", agency: "대리점", store: "매장",
};

// 역방향 순서: 매장 → 대리점 → 총판 → 본사
const DISPLAY_ROLES = ["store", "agency", "distributor", "hq"] as const;

const ACCESSIBLE_ROLES: Record<string, readonly string[]> = {
  superadmin: DISPLAY_ROLES,
  hq:         ["store", "agency", "distributor"],
  distributor:["store", "agency"],
  agency:     ["store"],
  store:      [],
};

const ROLE_BG: Record<string, string> = {
  store:      "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  agency:     "bg-orange-500/10 border-orange-500/30 text-orange-300",
  distributor:"bg-green-500/10  border-green-500/30  text-green-300",
  hq:         "bg-blue-500/10   border-blue-500/30   text-blue-300",
};

function fmt(n: number) { return n.toLocaleString("ko-KR"); }

// ── 단일 행 ────────────────────────────────────────────────
function FeeRow({
  item,
  isStore,
  onSave,
  isSaving,
}: {
  item: FeeListItem;
  isStore: boolean;
  onSave: (item: FeeListItem, deposit: number, withdrawal: number, rate: number) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);

  const ext      = item as typeof item & { usageFeeRate?: number | null; parentUsageFeeRate?: number | null };
  const myRate   = ext.usageFeeRate   ?? null;
  const parRate  = ext.parentUsageFeeRate ?? null;

  const [vals, setVals] = useState({
    deposit:    String(item.depositFee    ?? 0),
    withdrawal: String(item.withdrawalFee ?? 0),
    rate:       String(myRate ?? 0),
  });

  const hasConfig   = item.feeConfigId != null;
  const editRate    = parseFloat(vals.rate);
  const previewProfit = !isNaN(editRate) && parRate != null
    ? Math.round((editRate - parRate) * 100) / 100
    : !isNaN(editRate) && parRate == null
      ? editRate : null;

  const save = () => {
    const d = isStore ? parseInt(vals.deposit, 10) : 0;
    const w = isStore ? parseInt(vals.withdrawal, 10) : 0;
    const r = parseFloat(vals.rate);
    if (isNaN(r) || r < 0 || r > 100) return;
    if (isStore && (isNaN(d) || d < 0 || isNaN(w) || w < 0)) return;
    if (parRate != null && r < parRate) return;
    onSave(item, d, w, r);
    setEditing(false);
  };

  const cancel = () => {
    setVals({ deposit: String(item.depositFee ?? 0), withdrawal: String(item.withdrawalFee ?? 0), rate: String(myRate ?? 0) });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-4 py-3 bg-white/[0.03] border-b border-border/20 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-sm">{item.userName}</span>
            <span className="text-xs text-muted-foreground font-mono ml-2">({item.userLoginId})</span>
          </div>
          <div className="flex gap-1">
            <button onClick={save} disabled={isSaving}
              className="h-7 w-7 rounded flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button onClick={cancel}
              className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className={`grid gap-3 ${isStore ? "grid-cols-3" : "grid-cols-1 max-w-xs"}`}>
          {isStore && (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">입금 수수료 / 건</label>
                <div className="flex items-center gap-1">
                  <Input type="number" step="1" min="0" value={vals.deposit}
                    onChange={e => setVals(p => ({ ...p, deposit: e.target.value }))}
                    className="h-8 text-sm text-right" autoFocus />
                  <span className="text-xs text-muted-foreground">원</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">출금 수수료 / 건</label>
                <div className="flex items-center gap-1">
                  <Input type="number" step="1" min="0" value={vals.withdrawal}
                    onChange={e => setVals(p => ({ ...p, withdrawal: e.target.value }))}
                    className="h-8 text-sm text-right" />
                  <span className="text-xs text-muted-foreground">원</span>
                </div>
              </div>
            </>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {isStore ? "이용수수료율 (매장 총 부담)" : `전달률${parRate != null ? ` (최소 ${parRate}%)` : ""}`}
            </label>
            <div className="flex items-center gap-1">
              <Input type="number" step="0.01" min={parRate ?? 0} max="100"
                value={vals.rate}
                autoFocus={!isStore}
                onChange={e => {
                  const n = parseFloat(e.target.value);
                  if (parRate != null && !isNaN(n) && n < parRate) return;
                  setVals(p => ({ ...p, rate: e.target.value }));
                }}
                className="h-8 text-sm text-right" />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        {!isStore && previewProfit != null && (
          <p className="text-xs">
            {previewProfit > 0
              ? <><span className="text-emerald-400 font-semibold">수익 {previewProfit}%</span><span className="text-muted-foreground ml-1">(하위{vals.rate}% − 상위{parRate ?? 0}%)</span></>
              : <span className="text-red-400">최소 전달률 이상 설정 필요</span>
            }
          </p>
        )}
      </div>
    );
  }

  // view
  return (
    <div className="group flex items-center gap-3 px-4 py-3 border-b border-border/20 hover:bg-white/[0.02] last:border-b-0">
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm text-foreground">{item.userName}</span>
        <span className="text-xs text-muted-foreground font-mono ml-2 hidden sm:inline">({item.userLoginId})</span>
        {item.parentName && (
          <span className="text-xs text-muted-foreground ml-2 hidden md:inline">· {ROLE_LABELS[item.role] === "매장" ? "대리점" : ""} {item.parentName}</span>
        )}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        {isStore ? (
          <>
            {hasConfig ? (
              <>
                <div className="text-right hidden md:block">
                  <div className="text-[10px] text-muted-foreground">입금/건</div>
                  <div className="text-sm font-mono text-foreground">{fmt(item.depositFee ?? 0)}원</div>
                </div>
                <div className="text-right hidden md:block">
                  <div className="text-[10px] text-muted-foreground">출금/건</div>
                  <div className="text-sm font-mono text-foreground">{fmt(item.withdrawalFee ?? 0)}원</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">이용수수료율</div>
                  <div className="text-lg font-bold font-mono text-yellow-400">{myRate ?? 0}%</div>
                </div>
              </>
            ) : (
              <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-400">미설정</Badge>
            )}
          </>
        ) : (
          <>
            {hasConfig ? (
              <>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">수익률</div>
                  {myRate != null && parRate != null && myRate - parRate > 0
                    ? <div className="text-lg font-bold font-mono text-emerald-400">+{Math.round((myRate - parRate) * 100) / 100}%</div>
                    : <div className="text-sm font-mono text-muted-foreground">0%</div>
                  }
                </div>
                <div className="text-right hidden md:block">
                  <div className="text-[10px] text-muted-foreground">전달률</div>
                  <div className="text-sm font-mono text-muted-foreground">{myRate ?? 0}%</div>
                </div>
              </>
            ) : (
              <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-400">미설정</Badge>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => {
          setVals({ deposit: String(item.depositFee ?? 0), withdrawal: String(item.withdrawalFee ?? 0), rate: String(myRate ?? 0) });
          setEditing(true);
        }}
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
  );
}

// ── 역할 섹션 ─────────────────────────────────────────────
function RoleSection({
  role,
  isFirst,
  onSave,
  savingId,
}: {
  role: string;
  isFirst: boolean;
  onSave: (item: FeeListItem, d: number, w: number, u: number) => void;
  savingId: number | null;
}) {
  const { data, isLoading } = useListFees({ role });
  const isStore = role === "store";

  const unset = (data ?? []).filter(i => i.feeConfigId == null).length;

  return (
    <div>
      {/* 섹션 헤더 */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t border ${ROLE_BG[role] ?? ""}`}>
        <span className="font-bold text-sm">{ROLE_LABELS[role]}</span>
        {isLoading
          ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />
          : <span className="text-xs opacity-70">{(data ?? []).length}개</span>
        }
        {unset > 0 && (
          <Badge variant="outline" className="text-[10px] border-orange-400/40 text-orange-400 ml-auto">
            미설정 {unset}
          </Badge>
        )}
        {isStore && !isFirst && (
          <span className="text-xs opacity-60 ml-auto">· 매장이 실제 부담하는 수수료</span>
        )}
        {!isStore && (
          <span className="text-xs opacity-60 ml-auto">· 수익 = 하위전달률 − 상위전달률</span>
        )}
      </div>

      {/* 연결선 */}
      {!isFirst && (
        <div className="flex justify-center -mt-1 mb-0 z-10 relative">
          <ChevronDown className="h-4 w-4 text-muted-foreground/30" />
        </div>
      )}

      <Card className="rounded-t-none border-t-0 bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (data ?? []).length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4 opacity-40" />
              <span className="text-sm">{ROLE_LABELS[role]}이 없습니다</span>
            </div>
          ) : (
            (data ?? []).map(item => (
              <FeeRow
                key={item.userId}
                item={item}
                isStore={isStore}
                onSave={onSave}
                isSaving={savingId === item.userId}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
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

  const myRole  = user?.role ?? "store";
  const visible = (ACCESSIBLE_ROLES[myRole] ?? []) as string[];

  if (visible.length === 0) {
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
    const opts = {
      onSuccess: (msg: string) => () => { toast({ title: msg }); invalidate(); setSavingId(null); },
      onError: (e: unknown) => {
        toast({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "오류 발생", variant: "destructive" as const });
        setSavingId(null);
      },
    };
    if (item.feeConfigId != null) {
      update.mutate({ id: item.feeConfigId, data: payload }, { onSuccess: opts.onSuccess("수정 완료"), onError: opts.onError });
    } else {
      create.mutate({ data: { userId: item.userId, ...payload } }, { onSuccess: opts.onSuccess("설정 완료"), onError: opts.onError });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          매장 수수료율을 맨 위에서 설정하고, 아래로 각 계층의 배분을 설정합니다.
        </p>
      </div>

      <div className="space-y-0">
        {visible.map((role, idx) => (
          <RoleSection
            key={role}
            role={role}
            isFirst={idx === 0}
            onSave={handleSave}
            savingId={savingId}
          />
        ))}
      </div>
    </div>
  );
}
