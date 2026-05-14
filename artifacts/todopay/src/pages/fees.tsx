import React, { useState } from "react";
import {
  useListFees,
  useCreateFeeConfig,
  useUpdateFeeConfig,
} from "@workspace/api-client-react";
import type { FeeListItem } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pencil, Check, X, AlertCircle, Search, ChevronRight, TrendingDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Network, Store, Shield, Users as UsersIcon } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "슈퍼관리자",
  hq: "본사",
  distributor: "총판",
  agency: "대리점",
  store: "매장",
};
const ROLE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/40 text-purple-400 bg-purple-500/10",
  hq: "border-blue-500/40 text-blue-400 bg-blue-500/10",
  distributor: "border-green-500/40 text-green-400 bg-green-500/10",
  agency: "border-orange-500/40 text-orange-400 bg-orange-500/10",
  store: "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
};
const ROLE_ICONS: Record<string, React.ElementType> = {
  superadmin: Shield,
  hq: Building2,
  distributor: Network,
  agency: UsersIcon,
  store: Store,
};
const PARENT_ROLE_LABELS: Record<string, string> = {
  distributor: "본사",
  agency: "총판",
  store: "대리점",
};

const ACCESSIBLE_ROLES: Record<string, string[]> = {
  superadmin: ["hq", "distributor", "agency", "store"],
  hq: ["distributor", "agency", "store"],
  distributor: ["agency", "store"],
  agency: ["store"],
  store: [],
};

function fmt(n: number) { return n.toLocaleString("ko-KR"); }

// ——————————————————————————————————————————————————————————
// FeeRow
// ——————————————————————————————————————————————————————————
function FeeRow({
  item,
  onSave,
  isSaving,
}: {
  item: FeeListItem;
  onSave: (item: FeeListItem, deposit: number, withdrawal: number, usageFeeRate: number) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState({
    deposit: item.depositFee != null ? String(item.depositFee) : "0",
    withdrawal: item.withdrawalFee != null ? String(item.withdrawalFee) : "0",
    usageFeeRate: (item as { usageFeeRate?: number | null }).usageFeeRate != null
      ? String((item as { usageFeeRate?: number | null }).usageFeeRate)
      : "0",
  });

  const Icon = ROLE_ICONS[item.role] ?? Shield;
  const hasConfig = item.feeConfigId != null;

  const itemExt = item as typeof item & { usageFeeRate?: number | null; parentUsageFeeRate?: number | null };
  const currentUsageFeeRate = itemExt.usageFeeRate ?? null;
  const parentUsageFeeRate = itemExt.parentUsageFeeRate ?? null;

  // 이용수수료율: 역계층 — 하위(매장)가 높고 상위가 낮아야 함
  // 마진 = 자신 rate - 상위 rate (자신이 위로 전달하지 않고 갖는 몫)
  const usageFeeMargin = currentUsageFeeRate != null && parentUsageFeeRate != null
    ? Math.round((currentUsageFeeRate - parentUsageFeeRate) * 100) / 100
    : null;

  const validateAndSave = () => {
    const d = parseInt(vals.deposit, 10);
    const w = parseInt(vals.withdrawal, 10);
    const u = parseFloat(vals.usageFeeRate);
    if (isNaN(d) || isNaN(w) || isNaN(u) || d < 0 || w < 0 || u < 0 || u > 100) return;
    if (parentUsageFeeRate != null && u < parentUsageFeeRate) return;
    onSave(item, d, w, u);
    setEditing(false);
  };

  const handleCancel = () => {
    setVals({
      deposit: item.depositFee != null ? String(item.depositFee) : "0",
      withdrawal: item.withdrawalFee != null ? String(item.withdrawalFee) : "0",
      usageFeeRate: itemExt.usageFeeRate != null ? String(itemExt.usageFeeRate) : "0",
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="border-b border-border/20 p-3 space-y-3 bg-muted/10">
        <div className="flex items-center gap-2">
          <div className={`h-7 w-7 rounded border flex items-center justify-center shrink-0 ${ROLE_COLORS[item.role] ?? ""}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm">{item.userName}</span>
            <span className="text-xs text-muted-foreground font-mono ml-1.5 hidden sm:inline">({item.userLoginId})</span>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={validateAndSave}
              disabled={isSaving}
              className="h-7 w-7 rounded flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={handleCancel}
              className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* 입금 건당 수수료 (정액, 원) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">입금 수수료</label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="1"
                min="0"
                value={vals.deposit}
                onChange={(e) => setVals(p => ({ ...p, deposit: e.target.value }))}
                className="h-8 text-sm text-right"
                autoFocus
              />
              <span className="text-xs text-muted-foreground shrink-0">원</span>
            </div>
          </div>

          {/* 출금 건당 수수료 (정액, 원) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">출금 수수료</label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="1"
                min="0"
                value={vals.withdrawal}
                onChange={(e) => setVals(p => ({ ...p, withdrawal: e.target.value }))}
                className="h-8 text-sm text-right"
              />
              <span className="text-xs text-muted-foreground shrink-0">원</span>
            </div>
          </div>

          {/* 이용 수수료율 (%) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              이용 수수료율
              {parentUsageFeeRate != null && (
                <span className="text-amber-400 ml-1">(최소 {parentUsageFeeRate}%)</span>
              )}
            </label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                min={parentUsageFeeRate ?? 0}
                max="100"
                value={vals.usageFeeRate}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = parseFloat(v);
                  if (parentUsageFeeRate != null && !isNaN(n) && n < parentUsageFeeRate) return;
                  setVals(p => ({ ...p, usageFeeRate: v }));
                }}
                className="h-8 text-sm text-right"
              />
              <span className="text-xs text-muted-foreground shrink-0">%</span>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/20 rounded px-2 py-1.5 space-y-0.5">
          <p>• 입금/출금 수수료: 거래 건당 정액 (매장이 부담)</p>
          <p>• 이용 수수료율: 입금액의 % (매장 부담 → 상위 계층 배분)</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 px-3 py-3 border-b border-border/20 hover:bg-white/[0.02] last:border-b-0 min-w-0">
      <div className={`h-7 w-7 rounded border flex items-center justify-center shrink-0 ${ROLE_COLORS[item.role] ?? ""}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-sm text-foreground truncate">{item.userName}</span>
          <span className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:inline">({item.userLoginId})</span>
        </div>
        {item.parentName && (
          <div className="flex items-center gap-1 mt-0.5">
            <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">
              {PARENT_ROLE_LABELS[item.role] ?? ""} {item.parentName}
            </span>
          </div>
        )}
      </div>

      {/* 수수료 표시 */}
      <div className="flex items-center gap-3 shrink-0">
        {/* 입금 건당 */}
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-muted-foreground hidden md:block">입금/건</span>
          {hasConfig ? (
            <span className="font-mono text-sm text-primary font-semibold">{fmt(item.depositFee ?? 0)}원</span>
          ) : (
            <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground px-1.5 py-0">미설정</Badge>
          )}
        </div>

        {/* 출금 건당 */}
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-muted-foreground hidden md:block">출금/건</span>
          {hasConfig ? (
            <span className="font-mono text-sm text-orange-400 font-semibold">{fmt(item.withdrawalFee ?? 0)}원</span>
          ) : (
            <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground px-1.5 py-0">미설정</Badge>
          )}
        </div>

        {/* 이용 수수료율 */}
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-muted-foreground hidden md:block">이용률</span>
          {hasConfig ? (
            <span className="font-mono text-sm text-yellow-400 font-semibold">{currentUsageFeeRate ?? 0}%</span>
          ) : (
            <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground px-1.5 py-0">미설정</Badge>
          )}
          {usageFeeMargin != null && usageFeeMargin > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-emerald-400">
              <TrendingDown className="h-2.5 w-2.5" />
              <span>마진 {usageFeeMargin}%</span>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => {
          setVals({
            deposit: item.depositFee != null ? String(item.depositFee) : "0",
            withdrawal: item.withdrawalFee != null ? String(item.withdrawalFee) : "0",
            usageFeeRate: itemExt.usageFeeRate != null ? String(itemExt.usageFeeRate) : "0",
          });
          setEditing(true);
        }}
        className={[
          "h-7 px-2 rounded flex items-center gap-1 text-xs transition-colors shrink-0",
          hasConfig
            ? "text-muted-foreground hover:text-foreground hover:bg-white/10 opacity-0 group-hover:opacity-100"
            : "border border-primary/40 text-primary hover:bg-primary/10 opacity-100",
        ].join(" ")}
      >
        <Pencil className="h-3 w-3" />
        <span className="hidden sm:inline">{hasConfig ? "수정" : "설정"}</span>
      </button>
    </div>
  );
}

// ——————————————————————————————————————————————————————————
// RoleTab content
// ——————————————————————————————————————————————————————————
function RoleTabContent({
  role,
  onSave,
  savingId,
}: {
  role: string;
  onSave: (item: FeeListItem, d: number, w: number, u: number) => void;
  savingId: number | null;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListFees({ role });

  const items = (data ?? []).filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.userName.toLowerCase().includes(q) ||
      item.userLoginId.toLowerCase().includes(q) ||
      (item.parentName ?? "").toLowerCase().includes(q)
    );
  });

  const setCount = items.filter((i) => i.feeConfigId != null).length;
  const unsetCount = items.length - setCount;

  return (
    <div className="space-y-3">
      {(data ?? []).length > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="text-muted-foreground">전체 <strong className="text-foreground">{(data ?? []).length}</strong>개</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-primary">설정완료 <strong>{setCount}</strong>개</span>
          {unsetCount > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-orange-400">미설정 <strong>{unsetCount}</strong>개</span>
            </>
          )}
        </div>
      )}

      {(data ?? []).length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={`${ROLE_LABELS[role]} 검색...`}
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      <Card className="bg-card/50 border-border/50">
        <div className="hidden md:flex items-center h-8 border-b border-border/50 bg-muted/20 text-xs text-muted-foreground font-medium px-3 gap-2">
          <div className="w-7 shrink-0" />
          <div className="flex-1 min-w-0">이름 (아이디) / 상위</div>
          <div className="shrink-0 text-right pr-9 flex gap-6">
            <span>입금/건</span>
            <span>출금/건</span>
            <span>이용률</span>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
              <AlertCircle className="h-7 w-7 opacity-40" />
              <p className="text-sm">{search ? "검색 결과가 없습니다" : `${ROLE_LABELS[role]}이 없습니다`}</p>
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <FeeRow
                  key={item.userId}
                  item={item}
                  onSave={onSave}
                  isSaving={savingId === item.userId}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ——————————————————————————————————————————————————————————
// HQ fee section (for superadmin)
// ——————————————————————————————————————————————————————————
function HqFeeSection({
  onSave,
  savingId,
}: {
  onSave: (item: FeeListItem, d: number, w: number, u: number) => void;
  savingId: number | null;
}) {
  const { data, isLoading } = useListFees({ role: "hq" });
  const items = data ?? [];
  if (isLoading || items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-blue-400">본사 수수료 설정</h2>
        <span className="text-xs text-muted-foreground">— 이용수수료율은 하위 레벨의 최소 기준값</span>
      </div>
      <Card className="bg-card/50 border-blue-500/20">
        <CardContent className="p-0">
          {items.map((item) => (
            <FeeRow
              key={item.userId}
              item={item}
              onSave={onSave}
              isSaving={savingId === item.userId}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ——————————————————————————————————————————————————————————
// Main page
// ——————————————————————————————————————————————————————————
export default function Fees() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const create = useCreateFeeConfig();
  const update = useUpdateFeeConfig();
  const [savingId, setSavingId] = useState<number | null>(null);

  const myRole = user?.role ?? "store";

  const allAccessible = ACCESSIBLE_ROLES[myRole] ?? [];
  const roleTabs = myRole === "superadmin"
    ? allAccessible.filter((r) => r !== "hq")
    : allAccessible;

  const [activeTab, setActiveTab] = useState<string>(roleTabs[0] ?? "");

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/fees"] });

  const handleSave = (item: FeeListItem, deposit: number, withdrawal: number, usageFeeRate: number) => {
    setSavingId(item.userId);
    const payload = { depositFee: deposit, withdrawalFee: withdrawal, usageFeeRate };
    if (item.feeConfigId != null) {
      update.mutate(
        { id: item.feeConfigId, data: payload },
        {
          onSuccess: () => { toast({ title: "수수료 수정 완료" }); invalidate(); setSavingId(null); },
          onError: (e: unknown) => {
            const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "수정 실패";
            toast({ title: msg, variant: "destructive" });
            setSavingId(null);
          },
        },
      );
    } else {
      create.mutate(
        { data: { userId: item.userId, ...payload } },
        {
          onSuccess: () => { toast({ title: "수수료 설정 완료" }); invalidate(); setSavingId(null); },
          onError: (e: unknown) => {
            const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "설정 실패";
            toast({ title: msg, variant: "destructive" });
            setSavingId(null);
          },
        },
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          입금/출금 수수료는 거래 건당 정액(원). 이용 수수료율은 입금액의 %(매장 최대, 상위로 갈수록 감소 — 마진 = 자신율 − 상위율)
        </p>
      </div>

      {myRole === "superadmin" && (
        <HqFeeSection onSave={handleSave} savingId={savingId} />
      )}

      {roleTabs.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8 opacity-40" />
            <p className="text-sm">매장 계정은 하위 조직이 없습니다</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-1 flex-wrap">
            {roleTabs.map((role) => {
              const Icon = ROLE_ICONS[role] ?? Shield;
              const isActive = activeTab === role;
              return (
                <button
                  key={role}
                  onClick={() => setActiveTab(role)}
                  className={[
                    "flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-md text-sm font-medium transition-colors border",
                    isActive
                      ? `${ROLE_COLORS[role]} border-opacity-100`
                      : "text-muted-foreground border-border/40 hover:border-border hover:text-foreground hover:bg-white/5",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{ROLE_LABELS[role]}</span>
                </button>
              );
            })}
          </div>

          {activeTab && (
            <RoleTabContent
              key={activeTab}
              role={activeTab}
              onSave={handleSave}
              savingId={savingId}
            />
          )}
        </>
      )}
    </div>
  );
}
