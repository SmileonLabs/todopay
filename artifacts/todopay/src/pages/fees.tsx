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
  Loader2, Pencil, Check, X, AlertCircle, ChevronRight, Home, ArrowRight,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_LABELS: Record<string, string> = {
  hq: "본사", distributor: "총판", agency: "대리점", store: "매장",
};

const ROLE_BADGE: Record<string, string> = {
  store:       "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  agency:      "bg-orange-500/10 border-orange-500/30 text-orange-300",
  distributor: "bg-green-500/10  border-green-500/30  text-green-300",
  hq:          "bg-blue-500/10   border-blue-500/30   text-blue-300",
};

function fmt(n: number) { return n.toLocaleString("ko-KR"); }

type BreadcrumbEntry = { label: string; parentId: number | undefined };

// ── 단일 행 (인라인 편집 포함) ──────────────────────────────
function FeeItemRow({
  item,
  onSave,
  isSaving,
  onDrillDown,
}: {
  item: FeeListItem;
  onSave: (item: FeeListItem, deposit: number, withdrawal: number, rate: number) => void;
  isSaving: boolean;
  onDrillDown: (item: FeeListItem) => void;
}) {
  const isStore = item.role === "store";
  const [editing, setEditing] = useState(false);

  const ext      = item as typeof item & { usageFeeRate?: number | null; parentUsageFeeRate?: number | null };
  const myRate   = ext.usageFeeRate   ?? null;
  const parRate  = ext.parentUsageFeeRate ?? null;
  const hasConfig = item.feeConfigId != null;

  const [vals, setVals] = useState({
    deposit:    String(item.depositFee    ?? 0),
    withdrawal: String(item.withdrawalFee ?? 0),
    rate:       String(myRate ?? 0),
  });

  const previewProfit = !isNaN(parseFloat(vals.rate)) && parRate != null
    ? Math.round((parseFloat(vals.rate) - parRate) * 100) / 100
    : !isNaN(parseFloat(vals.rate)) && parRate == null
      ? parseFloat(vals.rate) : null;

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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ROLE_BADGE[item.role] ?? ""}`}>
              {ROLE_LABELS[item.role] ?? item.role}
            </Badge>
            <span className="font-semibold text-sm">{item.userName}</span>
            <span className="text-xs text-muted-foreground font-mono">({item.userLoginId})</span>
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
                value={vals.rate} autoFocus={!isStore}
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

  return (
    <div className="group flex items-center gap-3 px-4 py-3 border-b border-border/20 last:border-b-0 hover:bg-white/[0.02]">
      {/* 역할 배지 */}
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${ROLE_BADGE[item.role] ?? ""}`}>
        {ROLE_LABELS[item.role] ?? item.role}
      </Badge>

      {/* 이름 */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm">{item.userName}</span>
        <span className="text-xs text-muted-foreground font-mono ml-1.5 hidden sm:inline">({item.userLoginId})</span>
      </div>

      {/* 수수료 표시 */}
      <div className="flex items-center gap-4 shrink-0">
        {isStore ? (
          hasConfig ? (
            <>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-muted-foreground">입금/건</div>
                <div className="text-sm font-mono">{fmt(item.depositFee ?? 0)}원</div>
              </div>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-muted-foreground">출금/건</div>
                <div className="text-sm font-mono">{fmt(item.withdrawalFee ?? 0)}원</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">이용수수료율</div>
                <div className="text-lg font-bold font-mono text-yellow-400">{myRate ?? 0}%</div>
              </div>
            </>
          ) : (
            <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-400">미설정</Badge>
          )
        ) : (
          hasConfig ? (
            <>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">수익률</div>
                <div className="text-base font-bold font-mono text-emerald-400">
                  {myRate != null && parRate != null && myRate - parRate > 0
                    ? `+${Math.round((myRate - parRate) * 100) / 100}%`
                    : "0%"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">전달률</div>
                <div className="text-sm font-mono text-muted-foreground">{myRate ?? 0}%</div>
              </div>
            </>
          ) : (
            <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-400">미설정</Badge>
          )
        )}
      </div>

      {/* 액션 버튼 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => {
            setVals({ deposit: String(item.depositFee ?? 0), withdrawal: String(item.withdrawalFee ?? 0), rate: String(myRate ?? 0) });
            setEditing(true);
          }}
          className={[
            "h-7 px-2 rounded flex items-center gap-1 text-xs transition-colors",
            hasConfig
              ? "text-muted-foreground hover:text-foreground hover:bg-white/10 opacity-0 group-hover:opacity-100"
              : "border border-primary/40 text-primary hover:bg-primary/10",
          ].join(" ")}
        >
          <Pencil className="h-3 w-3" />
          <span className="hidden sm:inline">{hasConfig ? "수정" : "설정"}</span>
        </button>

        {/* 하위 드릴다운 버튼 (매장 제외) */}
        {!isStore && (
          <button
            onClick={() => onDrillDown(item)}
            className="h-7 px-2 rounded flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
            title="하위 계정 보기"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── 메인 ────────────────────────────────────────────────────
export default function Fees() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const { user }  = useAuth();
  const create    = useCreateFeeConfig();
  const update    = useUpdateFeeConfig();
  const [savingId, setSavingId] = useState<number | null>(null);

  const [stack, setStack] = useState<BreadcrumbEntry[]>([
    { label: "내 하위 계정", parentId: undefined },
  ]);

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

  const current = stack[stack.length - 1];

  const feesParams = current.parentId !== undefined
    ? { parentId: current.parentId }
    : myRole === "superadmin"
      ? { role: "hq" }
      : {};

  const { data, isLoading } = useListFees(feesParams);

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

  const drillDown = (item: FeeListItem) => {
    setStack(prev => [...prev, { label: item.userName, parentId: item.userId }]);
  };

  const navigateTo = (idx: number) => {
    setStack(prev => prev.slice(0, idx + 1));
  };

  const items = data ?? [];
  const unsetCount = items.filter(i => i.feeConfigId == null).length;

  // 현재 레벨 역할 파악 (첫 번째 아이템의 role)
  const currentLevelRole = items[0]?.role ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          하위 계정을 클릭해 드릴다운하며 각 계정의 수수료를 개별 설정합니다.
        </p>
      </div>

      {/* 브레드크럼 */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => navigateTo(0)}
          className={`flex items-center gap-1 text-sm px-2 py-1 rounded transition-colors ${stack.length === 1 ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-white/10"}`}
        >
          <Home className="h-3.5 w-3.5" />
          <span>내 하위 계정</span>
        </button>
        {stack.slice(1).map((entry, idx) => (
          <React.Fragment key={idx}>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <button
              onClick={() => navigateTo(idx + 1)}
              className={`text-sm px-2 py-1 rounded transition-colors ${idx + 1 === stack.length - 1 ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-white/10"}`}
            >
              {entry.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* 현재 레벨 정보 배너 */}
      {currentLevelRole && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className={`text-[10px] px-1.5 ${ROLE_BADGE[currentLevelRole] ?? ""}`}>
            {ROLE_LABELS[currentLevelRole] ?? currentLevelRole}
          </Badge>
          <span>{items.length}개 계정</span>
          {unsetCount > 0 && (
            <span className="text-orange-400">· 미설정 {unsetCount}개</span>
          )}
          {currentLevelRole !== "store" && (
            <span className="ml-auto hidden md:block opacity-60">
              · 계정명 우측 <ArrowRight className="h-3 w-3 inline" /> 클릭 시 하위 계정으로 이동
            </span>
          )}
          {currentLevelRole === "store" && (
            <span className="ml-auto hidden md:block opacity-60">
              · 매장이 실제 부담하는 총 수수료율
            </span>
          )}
        </div>
      )}

      {/* 목록 */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <AlertCircle className="h-7 w-7 opacity-30" />
              <p className="text-sm">하위 계정이 없습니다</p>
            </div>
          ) : (
            items.map(item => (
              <FeeItemRow
                key={item.userId}
                item={item}
                onSave={handleSave}
                isSaving={savingId === item.userId}
                onDrillDown={drillDown}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
