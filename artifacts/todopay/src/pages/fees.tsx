import React, { useState, useMemo, useCallback } from "react";
import {
  useListFees,
  useCreateFeeConfig,
  useUpdateFeeConfig,
} from "@workspace/api-client-react";
import type { FeeListItem } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { can } from "@/lib/access-control";
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

type FeeItem = FeeListItem & {
  usageFeeRate?: number | null;
  parentUsageFeeRate?: number | null;
  minChildUsageFeeRate?: number | null;
  allocatedUsageFeeRate?: number | null;
  storeShare?: number | null;
};

type SimulationResult = {
  policy: {
    storeName: string;
    totalRate: number;
    depositFee: number;
    withdrawalFee: number;
  };
  allocation: {
    grossAmount: number;
    todoPayFee: number;
    settlementAmount: number;
    internalFeeAmount: number;
    storeCommissionAmount: number;
    entries: Array<{
      beneficiaryUserId: number;
      role: string;
      name: string;
      rate: number;
      amount: number;
      commissionAmount: number;
    }>;
  };
  note: string;
};

function FeeSimulation({ stores }: { stores: FeeItem[] }) {
  const [storeId, setStoreId] = useState("");
  const [grossAmount, setGrossAmount] = useState("100000");
  const [todoPayFee, setTodoPayFee] = useState("1000");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!storeId && stores[0]) setStoreId(String(stores[0].userId));
  }, [storeId, stores]);

  const settlementAmount = Math.max(
    0,
    (Number(grossAmount) || 0) - (Number(todoPayFee) || 0),
  );

  const simulate = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/internal-fees/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId: Number(storeId),
          grossAmount: Number(grossAmount),
          todoPayFee: Number(todoPayFee),
          settlementAmount,
        }),
      });
      const body = await response.json() as SimulationResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "계산에 실패했습니다.");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "계산에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  if (stores.length === 0) return null;

  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-4 md:p-5 space-y-4">
        <div>
          <h2 className="font-semibold">수수료 배분 검증</h2>
          <p className="text-xs text-muted-foreground mt-1">
            실제 거래를 만들지 않고 현재 설정으로 정산금 보존과 조직별 배분을 확인합니다.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">매장</span>
            <select
              value={storeId}
              onChange={event => setStoreId(event.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3"
            >
              {stores.map(store => (
                <option key={store.userId} value={store.userId}>
                  {store.userName} ({store.userLoginId})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">결제금액</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={grossAmount}
              onChange={event => setGrossAmount(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">TodoPay 수수료</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={todoPayFee}
              onChange={event => setTodoPayFee(event.target.value)}
            />
          </label>
          <div className="space-y-1 text-xs">
            <span className="text-muted-foreground">Sellink 정산금</span>
            <div className="h-9 rounded-md border border-input bg-muted/40 px-3 flex items-center font-mono">
              {fmt(settlementAmount)}원
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void simulate()}
          disabled={loading || !storeId}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {loading ? "계산 중..." : "현재 설정으로 검증"}
        </button>
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-md border border-border/50 p-3">
                <div className="text-xs text-muted-foreground">내부 수수료 풀</div>
                <div className="font-mono font-semibold">
                  {fmt(result.allocation.internalFeeAmount)}원 ({result.policy.totalRate}%)
                </div>
              </div>
              <div className="rounded-md border border-border/50 p-3">
                <div className="text-xs text-muted-foreground">매장 수수료 몫</div>
                <div className="font-mono font-semibold text-emerald-400">
                  {fmt(result.allocation.storeCommissionAmount)}원
                </div>
              </div>
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
                <div className="text-xs text-emerald-300">배분 합계 검증</div>
                <div className="font-mono font-semibold text-emerald-300">
                  {fmt(result.allocation.entries.reduce((sum, entry) => sum + entry.amount, 0))}원 일치
                </div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border/50">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">수취 주체</th>
                    <th className="text-right px-3 py-2">배분율</th>
                    <th className="text-right px-3 py-2">수수료 몫</th>
                    <th className="text-right px-3 py-2">정산 반영액</th>
                  </tr>
                </thead>
                <tbody>
                  {result.allocation.entries.map(entry => (
                    <tr key={entry.beneficiaryUserId} className="border-t border-border/40">
                      <td className="px-3 py-2">{entry.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{entry.rate}%</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmt(entry.commissionAmount)}원
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmt(entry.amount)}원
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{result.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 인라인 편집 폼 ─────────────────────────────────────────
function EditForm({
  item,
  isStore,
  onSave,
  onCancel,
  isSaving,
  minRate = 0,
  maxRate = 100,
}: {
  item: FeeItem;
  isStore: boolean;
  onSave: (d: number, w: number, r: number) => void;
  onCancel: () => void;
  isSaving: boolean;
  minRate?: number;
  maxRate?: number;
}) {
  const [vals, setVals] = useState({
    deposit:    String(item.depositFee    ?? 0),
    withdrawal: String(item.withdrawalFee ?? 0),
    rate:       String(item.usageFeeRate  ?? 0),
  });

  const rateNum    = parseFloat(vals.rate);
  const belowMinimum = !isNaN(rateNum) && rateNum < minRate;
  const aboveMaximum = !isNaN(rateNum) && rateNum > maxRate;
  const rateInvalid = belowMinimum || aboveMaximum;
  const rateGuide = [
    minRate > 0 ? `최소 ${minRate}%` : null,
    maxRate < 100 ? `최대 ${maxRate}%` : null,
  ].filter(Boolean).join(" · ");

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
            <label className="text-[10px] text-muted-foreground">구매수수료/건</label>
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
          {isStore ? "이용수수료율" : "수수료율"}
          {rateGuide ? ` (${rateGuide})` : ""}
        </label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            step="0.01"
            min={minRate}
            max={maxRate}
            value={vals.rate}
            autoFocus={!isStore}
            onChange={e => setVals(p => ({ ...p, rate: e.target.value }))}
            className={`h-7 text-xs w-20 text-right ${rateInvalid ? "border-red-500" : ""}`} />
          <span className="text-[10px] text-muted-foreground">%</span>
        </div>
      </div>
      {belowMinimum && (
        <span className="text-xs text-red-400 self-center">조직 배분 합계 이상으로 설정해야 합니다</span>
      )}
      {aboveMaximum && (
        <span className="text-xs text-red-400 self-center">남은 수수료 {maxRate}%를 초과할 수 없습니다</span>
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
  maxRate,
  canManage,
}: {
  item: FeeItem;
  depth: number;
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
  maxRate: number;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const myRate  = item.usageFeeRate ?? null;
  const hasConfig = item.feeConfigId != null;
  const isSaving  = savingId === item.userId;

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
              <span className="text-xs font-mono text-emerald-400">{myRate ?? 0}%</span>
            ) : (
              <Badge variant="outline" className="text-[9px] border-orange-500/40 text-orange-400">미설정</Badge>
            )}

            {canManage && <button
              onClick={() => setEditing(v => !v)}
              className="opacity-0 group-hover:opacity-100 h-5 px-1.5 rounded flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all ml-auto shrink-0"
            >
              <Pencil className="h-2.5 w-2.5" />
              <span>{hasConfig ? "수정" : "설정"}</span>
            </button>}
          </div>

          {editing && (
            <EditForm
              item={item}
              isStore={false}
              onSave={(d, w, r) => { onSave(item, d, w, r); setEditing(false); }}
              onCancel={() => setEditing(false)}
              isSaving={isSaving}
              maxRate={maxRate}
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
  maxRateByUser,
  canManage,
  currentUserId,
}: {
  store: FeeItem;
  ancestry: FeeItem[];
  onSave: (item: FeeListItem, d: number, w: number, r: number) => void;
  savingId: number | null;
  defaultOpen: boolean;
  maxRateByUser: Map<number, number>;
  canManage: boolean;
  currentUserId: number | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const hasConfig = store.feeConfigId != null;
  const isSaving  = savingId === store.userId;
  const allocatedRate = store.allocatedUsageFeeRate ?? Math.round(
    ancestry.reduce((sum, item) => sum + (item.usageFeeRate ?? 0), 0) * 100,
  ) / 100;
  const visibleAllocatedRate = Math.round(
    ancestry.reduce((sum, item) => sum + (item.usageFeeRate ?? 0), 0) * 100,
  ) / 100;
  const hiddenUpstreamRate = Math.max(
    0,
    Math.round((allocatedRate - visibleAllocatedRate) * 100) / 100,
  );
  const storeShare = hasConfig
    ? store.storeShare ?? Math.max(0, Math.round(((store.usageFeeRate ?? 0) - allocatedRate) * 100) / 100)
    : null;

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
          {storeShare != null && (
            <span className="text-xs font-mono text-emerald-400 ml-2">
              {storeShare}%
            </span>
          )}
        </div>

        {/* 수수료 표시 */}
        <div className="flex items-center gap-3 shrink-0">
          {hasConfig ? (
            <>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-muted-foreground">구매/건</div>
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

          {canManage && <button
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
          </button>}
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
            minRate={allocatedRate}
          />
        </div>
      )}

      {/* ── 상위 수수료 흐름 (접기/펼치기) ── */}
      {open && (
        <div className="pb-2">
          {ancestry.length === 0 ? (
            <p className="px-10 py-1 text-xs text-muted-foreground">상위 수수료 정보 없음</p>
          ) : (
            <>
              {ancestry.map((ancestor, idx) => (
                <AncestorRow
                  key={ancestor.userId}
                  item={ancestor}
                  depth={idx}
                  onSave={onSave}
                  savingId={savingId}
                  maxRate={maxRateByUser.get(ancestor.userId) ?? 100}
                  canManage={canManage && ancestor.userId !== currentUserId}
                />
              ))}
              {hiddenUpstreamRate > 0 && (
                <div
                  className="flex items-center gap-2 py-1.5 pr-3 text-xs text-muted-foreground"
                  style={{ paddingLeft: ancestry.length * 20 + 32 }}
                >
                  <ArrowUp className="h-3 w-3 text-border/60" />
                  <Badge variant="outline" className="text-[9px] px-1 py-0">
                    상위
                  </Badge>
                  <span>상위 조직 배정</span>
                  <span className="font-mono text-emerald-400">{hiddenUpstreamRate}%</span>
                </div>
              )}
            </>
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
  const canManageFees = can(user, "fees.manage");
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

  const stores = (storeList ?? []) as FeeItem[];
  const maxRateByUser = useMemo(() => {
    const limits = new Map<number, number>();

    for (const store of stores) {
      const ancestry = getAncestry(store);
      const totalRate = store.usageFeeRate ?? 0;
      const allocatedRate = store.allocatedUsageFeeRate ?? ancestry.reduce(
        (sum, item) => sum + (item.usageFeeRate ?? 0),
        0,
      );

      for (const item of ancestry) {
        const currentRate = item.usageFeeRate ?? 0;
        const availableRate = Math.max(
          0,
          Math.round((totalRate - (allocatedRate - currentRate)) * 100) / 100,
        );
        const existingLimit = limits.get(item.userId);
        limits.set(
          item.userId,
          existingLimit == null ? availableRate : Math.min(existingLimit, availableRate),
        );
      }
    }

    return limits;
  }, [stores, getAncestry]);

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
      const error = e as {
        data?: { error?: string };
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast({
        title: error.data?.error ?? error.response?.data?.error ?? error.message ?? "오류 발생",
        variant: "destructive",
      });
      setSavingId(null);
    };
    if (item.feeConfigId != null) {
      update.mutate({ id: item.feeConfigId, data: payload }, { onSuccess: done("수정 완료"), onError: fail });
    } else {
      create.mutate({ data: { userId: item.userId, ...payload } }, { onSuccess: done("설정 완료"), onError: fail });
    }
  };

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
          매장과 각 조직의 표시값 합계가 이용수수료율과 같아지도록 자동 계산합니다.
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
                maxRateByUser={maxRateByUser}
                canManage={canManageFees}
                currentUserId={user?.id ?? null}
              />
            ))
          )}
        </CardContent>
      </Card>
      <FeeSimulation stores={stores} />
    </div>
  );
}
