import React, { useState, useMemo, useCallback } from "react";
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
  Loader2, Pencil, Check, X, AlertCircle, ChevronDown, ChevronRight, ArrowUp,
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

function fmt(n: number) { return n.toLocaleString("ko-KR"); }

type FeeItem = FeeListItem & { usageFeeRate?: number | null; parentUsageFeeRate?: number | null };

// ── 인라인 편집 폼 ─────────────────────────────────────────
function EditForm({
  item,
  isStore,
  onSave,
  onCancel,
  isSaving,
}: {
  item: FeeItem;
  isStore: boolean;
  onSave: (d: number, w: number, r: number) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const parRate = item.parentUsageFeeRate ?? null;
  const [vals, setVals] = useState({
    deposit:    String(item.depositFee    ?? 0),
    withdrawal: String(item.withdrawalFee ?? 0),
    rate:       String(item.usageFeeRate  ?? 0),
  });

  const rateNum    = parseFloat(vals.rate);
  const rateInvalid = !isNaN(rateNum) && parRate != null && rateNum < parRate;
  const profit     = !isNaN(rateNum) && parRate != null ? Math.round((rateNum - parRate) * 100) / 100 : null;

  const save = () => {
    const d = isStore ? parseInt(vals.deposit, 10) : 0;
    const w = isStore ? parseInt(vals.withdrawal, 10) : 0;
    const r = parseFloat(vals.rate);
    if (isNaN(r) || r < 0 || r > 100 || rateInvalid) return;
    if (isStore && (isNaN(d) || d < 0 || isNaN(w) || w < 0)) return;
    onSave(d, w, r);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 py-2 px-3 bg-white/[0.05] rounded-lg mt-1">
      {isStore && (
        <>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">입금수수료/건</label>
            <div className="flex items-center gap-1">
              <Input type="number" step="1" min="0" value={vals.deposit} autoFocus
                onChange={e => setVals(p => ({ ...p, deposit: e.target.value }))}
                className="h-7 text-xs w-24 text-right" />
              <span className="text-[10px] text-muted-foreground">원</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">출금수수료/건</label>
            <div className="flex items-center gap-1">
              <Input type="number" step="1" min="0" value={vals.withdrawal}
                onChange={e => setVals(p => ({ ...p, withdrawal: e.target.value }))}
                className="h-7 text-xs w-24 text-right" />
              <span className="text-[10px] text-muted-foreground">원</span>
            </div>
          </div>
        </>
      )}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">
          {isStore ? "이용수수료율" : `전달률${parRate != null ? ` (최소 ${parRate}%)` : ""}`}
        </label>
        <div className="flex items-center gap-1">
          <Input type="number" step="0.01" min={parRate ?? 0} max="100" value={vals.rate}
            autoFocus={!isStore}
            onChange={e => {
              const n = parseFloat(e.target.value);
              if (parRate != null && !isNaN(n) && n < parRate) return;
              setVals(p => ({ ...p, rate: e.target.value }));
            }}
            className={`h-7 text-xs w-20 text-right ${rateInvalid ? "border-red-500" : ""}`} />
          <span className="text-[10px] text-muted-foreground">%</span>
        </div>
      </div>
      {!isStore && profit != null && profit > 0 && (
        <span className="text-xs text-emerald-400 self-center">수익 +{profit}%</span>
      )}
      {rateInvalid && (
        <span className="text-xs text-red-400 self-center">최소 {parRate}% 이상</span>
      )}
      <div className="flex gap-1 self-end ml-auto">
        <button onClick={save} disabled={isSaving || rateInvalid}
          className="h-7 px-2 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40 flex items-center gap-1 text-xs">
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          저장
        </button>
        <button onClick={onCancel}
          className="h-7 px-2 rounded text-muted-foreground hover:bg-white/10 flex items-center gap-1 text-xs">
          <X className="h-3 w-3" /> 취소
        </button>
      </div>
    </div>
  );
}

// ── 상위 계정 행 (수수료 흐름에서 표시) ───────────────────────
function AncestorRow({
  item,
  depth,
  onSave,
  savingId,
}: {
  item: FeeItem;
  depth: number;
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const myRate  = item.usageFeeRate         ?? null;
  const parRate = item.parentUsageFeeRate   ?? null;
  const hasConfig = item.feeConfigId != null;
  const isSaving  = savingId === item.userId;

  const profit = myRate != null && parRate != null
    ? Math.round((myRate - parRate) * 100) / 100
    : null;

  return (
    <div style={{ paddingLeft: depth * 20 + 12 }}>
      <div className="flex items-start gap-2 py-1.5 pr-3">
        {/* 화살표 — "위로 올라가는" 표현 */}
        <div className="flex flex-col items-center shrink-0 mt-0.5">
          <div className="w-px h-3 bg-border/40" />
          <ArrowUp className="h-3 w-3 text-border/60" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="group flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${ROLE_BADGE[item.role] ?? ""}`}>
              {ROLE_LABELS[item.role] ?? item.role}
            </Badge>
            <span className="text-xs font-medium">{item.userName}</span>
            <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">({item.userLoginId})</span>

            {hasConfig ? (
              <>
                <span className="text-xs font-mono text-muted-foreground">전달률 {myRate ?? 0}%</span>
                {profit != null && profit > 0 && (
                  <span className="text-xs font-mono text-emerald-400">수익 +{profit}%</span>
                )}
              </>
            ) : (
              <Badge variant="outline" className="text-[9px] border-orange-500/40 text-orange-400">미설정</Badge>
            )}

            <button
              onClick={() => setEditing(v => !v)}
              className="opacity-0 group-hover:opacity-100 h-5 px-1.5 rounded flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all ml-auto shrink-0"
            >
              <Pencil className="h-2.5 w-2.5" />
              <span>{hasConfig ? "수정" : "설정"}</span>
            </button>
          </div>

          {editing && (
            <EditForm
              item={item}
              isStore={false}
              onSave={(d, w, r) => { onSave(item, d, w, r); setEditing(false); }}
              onCancel={() => setEditing(false)}
              isSaving={isSaving}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 매장 행 ────────────────────────────────────────────────
function StoreRow({
  store,
  ancestry,
  onSave,
  savingId,
  defaultOpen,
}: {
  store: FeeItem;
  ancestry: FeeItem[];
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const hasConfig = store.feeConfigId != null;
  const isSaving  = savingId === store.userId;

  return (
    <div className="border-b border-border/20 last:border-b-0">
      {/* ── 매장 메인 행 ── */}
      <div className="group flex items-center gap-2 px-3 py-3 hover:bg-white/[0.02]">
        {/* 펼치기 (상위 수수료 흐름) */}
        <button
          onClick={() => setOpen(v => !v)}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/10 shrink-0"
          title={open ? "수수료 흐름 접기" : "수수료 흐름 보기"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${ROLE_BADGE["store"]}`}>
          매장
        </Badge>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm">{store.userName}</span>
          <span className="text-xs text-muted-foreground font-mono ml-1.5 hidden sm:inline">({store.userLoginId})</span>
        </div>

        {/* 수수료 표시 */}
        <div className="flex items-center gap-3 shrink-0">
          {hasConfig ? (
            <>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-muted-foreground">입금/건</div>
                <div className="text-xs font-mono">{fmt(store.depositFee ?? 0)}원</div>
              </div>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-muted-foreground">출금/건</div>
                <div className="text-xs font-mono">{fmt(store.withdrawalFee ?? 0)}원</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">이용수수료율</div>
                <div className="text-lg font-bold font-mono text-yellow-400">{store.usageFeeRate ?? 0}%</div>
              </div>
            </>
          ) : (
            <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-400 shrink-0">미설정</Badge>
          )}

          <button
            onClick={() => setEditing(v => !v)}
            className={[
              "h-7 px-2 rounded flex items-center gap-1 text-xs transition-colors shrink-0",
              hasConfig
                ? "text-muted-foreground hover:text-foreground hover:bg-white/10 opacity-0 group-hover:opacity-100"
                : "border border-primary/40 text-primary hover:bg-primary/10",
            ].join(" ")}
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
            <span className="hidden sm:inline">{hasConfig ? "수정" : "설정"}</span>
          </button>
        </div>
      </div>

      {/* 인라인 편집 (매장) */}
      {editing && (
        <div className="px-3 pb-3">
          <EditForm
            item={store}
            isStore={true}
            onSave={(d, w, r) => { onSave(store, d, w, r); setEditing(false); }}
            onCancel={() => setEditing(false)}
            isSaving={isSaving}
          />
        </div>
      )}

      {/* ── 상위 수수료 흐름 (접기/펼치기) ── */}
      {open && (
        <div className="pb-2">
          {ancestry.length === 0 ? (
            <p className="px-10 py-1 text-xs text-muted-foreground">상위 수수료 정보 없음</p>
          ) : (
            ancestry.map((ancestor, idx) => (
              <AncestorRow
                key={ancestor.userId}
                item={ancestor}
                depth={idx}
                onSave={onSave}
                savingId={savingId}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────
export default function Fees() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const { user }  = useAuth();
  const create    = useCreateFeeConfig();
  const update    = useUpdateFeeConfig();
  const [savingId, setSavingId] = useState<number | null>(null);

  const myRole = user?.role ?? "store";

  // 모든 레벨 병렬 로딩
  const { data: hqList,   isLoading: hqLoad }   = useListFees({ role: "hq" });
  const { data: distList, isLoading: distLoad }  = useListFees({ role: "distributor" });
  const { data: agList,   isLoading: agLoad }    = useListFees({ role: "agency" });
  const { data: storeList,isLoading: storeLoad } = useListFees({ role: "store" });

  const isLoading = hqLoad || distLoad || agLoad || storeLoad;

  // userId → item 맵 (ancestor 조회용)
  const userMap = useMemo(() => {
    const m = new Map<number, FeeItem>();
    [...(hqList ?? []), ...(distList ?? []), ...(agList ?? [])].forEach(i => m.set(i.userId, i as FeeItem));
    return m;
  }, [hqList, distList, agList]);

  // 매장의 상위 체인 (대리점 → 총판 → 본사 순서)
  const getAncestry = useCallback((item: FeeItem): FeeItem[] => {
    const chain: FeeItem[] = [];
    const visited = new Set<number>();
    let parentId = item.parentId ?? null;
    while (parentId != null && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = userMap.get(parentId);
      if (!parent) break;
      chain.push(parent as FeeItem);
      parentId = parent.parentId ?? null;
    }
    return chain;
  }, [userMap]);

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

  const stores = (storeList ?? []) as FeeItem[];
  // 미설정 매장 먼저
  const sorted = [...stores].sort((a, b) => {
    if ((a.feeConfigId == null) !== (b.feeConfigId == null)) return a.feeConfigId == null ? -1 : 1;
    return a.userName.localeCompare(b.userName, "ko");
  });

  const unsetCount = stores.filter(s => s.feeConfigId == null).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          매장별 수수료를 확인·수정하고, ▶를 눌러 상위 수수료 흐름을 확인합니다.
        </p>
      </div>

      <Card className="bg-card/50 border-border/50">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {isLoading
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span>불러오는 중...</span></>
              : <><span>매장 {stores.length}개</span>
                  {unsetCount > 0 && <span className="text-orange-400">· 미설정 {unsetCount}개</span>}
                </>
            }
          </div>
          <div className="hidden md:flex items-center gap-1 opacity-60">
            <ChevronRight className="h-3.5 w-3.5" />
            <span>▶ 클릭 시 상위 수수료 흐름 표시</span>
          </div>
        </div>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <AlertCircle className="h-7 w-7 opacity-30" />
              <p className="text-sm">매장이 없습니다</p>
            </div>
          ) : (
            sorted.map((store, idx) => (
              <StoreRow
                key={store.userId}
                store={store}
                ancestry={getAncestry(store)}
                onSave={handleSave}
                savingId={savingId}
                defaultOpen={sorted.length <= 3 && idx === 0}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
