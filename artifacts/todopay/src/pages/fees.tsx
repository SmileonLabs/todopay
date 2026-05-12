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
import { Loader2, Pencil, Check, X, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2, Network, Store, Shield, Users as UsersIcon,
} from "lucide-react";

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
const ROLE_ICONS: Record<string, React.ElementType> = {
  superadmin: Shield, hq: Building2, distributor: Network, agency: UsersIcon, store: Store,
};
const CHILD_ROLE_LABELS: Record<string, string> = {
  superadmin: "본사", hq: "총판", distributor: "대리점", agency: "매장", store: "",
};

type EditState = { deposit: string; withdrawal: string };

function FeeRow({
  item,
  onSave,
  isSaving,
}: {
  item: FeeListItem;
  onSave: (item: FeeListItem, deposit: number, withdrawal: number) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<EditState>({
    deposit: item.depositFee != null ? String(item.depositFee) : "0",
    withdrawal: item.withdrawalFee != null ? String(item.withdrawalFee) : "0",
  });

  const Icon = ROLE_ICONS[item.role] ?? Shield;
  const hasConfig = item.feeConfigId != null;

  const handleSave = () => {
    const d = parseFloat(vals.deposit);
    const w = parseFloat(vals.withdrawal);
    if (isNaN(d) || isNaN(w) || d < 0 || w < 0 || d > 100 || w > 100) return;
    onSave(item, d, w);
    setEditing(false);
  };

  const handleCancel = () => {
    setVals({
      deposit: item.depositFee != null ? String(item.depositFee) : "0",
      withdrawal: item.withdrawalFee != null ? String(item.withdrawalFee) : "0",
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="border-b border-border/20 p-3 space-y-3 bg-muted/10">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <div className={`h-7 w-7 rounded border flex items-center justify-center shrink-0 ${ROLE_COLORS[item.role] ?? ""}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm">{item.userName}</span>
            <span className="text-xs text-muted-foreground font-mono ml-1.5 hidden sm:inline">({item.userLoginId})</span>
          </div>
          <div className="flex gap-1">
            <button onClick={handleSave} disabled={isSaving}
              className="h-7 w-7 rounded flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button onClick={handleCancel}
              className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-white/10 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {/* Input row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">입금 수수료 (%)</label>
            <div className="flex items-center gap-1">
              <Input type="number" step="0.01" min="0" max="100"
                value={vals.deposit}
                onChange={(e) => setVals(p => ({ ...p, deposit: e.target.value }))}
                className="h-8 text-sm text-right" autoFocus />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">출금 수수료 (%)</label>
            <div className="flex items-center gap-1">
              <Input type="number" step="0.01" min="0" max="100"
                value={vals.withdrawal}
                onChange={(e) => setVals(p => ({ ...p, withdrawal: e.target.value }))}
                className="h-8 text-sm text-right" />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 px-3 py-3 border-b border-border/20 hover:bg-white/[0.02] last:border-b-0">
      {/* Role icon */}
      <div className={`h-7 w-7 rounded border flex items-center justify-center shrink-0 ${ROLE_COLORS[item.role] ?? ""}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Badge — hide on very small screens */}
      <Badge variant="outline" className={`text-[10px] font-medium px-1.5 hidden sm:flex shrink-0 ${ROLE_COLORS[item.role] ?? ""}`}>
        {ROLE_LABELS[item.role] ?? item.role}
      </Badge>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm text-foreground">{item.userName}</span>
        <span className="text-xs text-muted-foreground font-mono ml-1.5 hidden sm:inline">({item.userLoginId})</span>
      </div>

      {/* Fee values */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground hidden md:inline">입금</span>
          {hasConfig ? (
            <span className="font-mono text-sm text-primary font-semibold">{item.depositFee}%</span>
          ) : (
            <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">미설정</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground hidden md:inline">출금</span>
          {hasConfig ? (
            <span className="font-mono text-sm text-primary font-semibold">{item.withdrawalFee}%</span>
          ) : (
            <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">미설정</Badge>
          )}
        </div>
      </div>

      {/* Edit button */}
      <button
        onClick={() => {
          setVals({
            deposit: item.depositFee != null ? String(item.depositFee) : "0",
            withdrawal: item.withdrawalFee != null ? String(item.withdrawalFee) : "0",
          });
          setEditing(true);
        }}
        className={`h-7 px-2 rounded flex items-center gap-1 text-xs transition-colors shrink-0 ${
          hasConfig
            ? "text-muted-foreground hover:text-foreground hover:bg-white/10 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            : "border border-primary/40 text-primary hover:bg-primary/10 opacity-100"
        }`}
      >
        <Pencil className="h-3 w-3" />
        <span className="hidden sm:inline">{hasConfig ? "수정" : "설정"}</span>
      </button>
    </div>
  );
}

export default function Fees() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useListFees({});
  const create = useCreateFeeConfig();
  const update = useUpdateFeeConfig();

  const [savingId, setSavingId] = useState<number | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/fees"] });

  const handleSave = (item: FeeListItem, deposit: number, withdrawal: number) => {
    setSavingId(item.userId);
    if (item.feeConfigId != null) {
      update.mutate(
        { id: item.feeConfigId, data: { depositFee: deposit, withdrawalFee: withdrawal } },
        {
          onSuccess: () => { toast({ title: "수수료 수정 완료" }); invalidate(); setSavingId(null); },
          onError: () => { toast({ title: "수정 실패", variant: "destructive" }); setSavingId(null); },
        },
      );
    } else {
      create.mutate(
        { data: { userId: item.userId, depositFee: deposit, withdrawalFee: withdrawal } },
        {
          onSuccess: () => { toast({ title: "수수료 설정 완료" }); invalidate(); setSavingId(null); },
          onError: () => { toast({ title: "설정 실패", variant: "destructive" }); setSavingId(null); },
        },
      );
    }
  };

  const myRole = user?.role ?? "store";
  const childRoleLabel = CHILD_ROLE_LABELS[myRole] ?? "";
  const items = data ?? [];
  const setCount = items.filter(i => i.feeConfigId != null).length;
  const unsetCount = items.length - setCount;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">수수료 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {childRoleLabel
            ? `직속 ${childRoleLabel} 별 입금·출금 수수료율을 설정합니다 (%)`
            : "하위 조직이 없습니다"}
        </p>
      </div>

      {/* Summary cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="pt-3 pb-3 px-3 md:pt-4 md:pb-4 md:px-4">
              <div className="text-xl md:text-2xl font-bold text-foreground">{items.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">전체</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardContent className="pt-3 pb-3 px-3 md:pt-4 md:pb-4 md:px-4">
              <div className="text-xl md:text-2xl font-bold text-primary">{setCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">설정 완료</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border/50">
            <CardContent className="pt-3 pb-3 px-3 md:pt-4 md:pb-4 md:px-4">
              <div className={`text-xl md:text-2xl font-bold ${unsetCount > 0 ? "text-orange-400" : "text-muted-foreground"}`}>
                {unsetCount}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">미설정</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fee list */}
      <Card className="bg-card/50 border-border/50">
        {/* Column header — desktop only */}
        <div className="hidden md:flex items-center h-9 border-b border-border/50 bg-muted/20 text-xs text-muted-foreground font-medium px-3 gap-2">
          <div className="w-7 shrink-0" />
          <div className="w-[80px] shrink-0">역할</div>
          <div className="flex-1 min-w-0">이름 (아이디)</div>
          <div className="w-32 shrink-0 text-right pr-8">입금 · 출금 수수료</div>
        </div>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
              <AlertCircle className="h-8 w-8 opacity-40" />
              <div className="text-sm">
                {myRole === "store" ? "매장 계정은 하위 조직이 없습니다" : "직속 하위 조직이 없습니다"}
              </div>
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <FeeRow
                  key={item.userId}
                  item={item}
                  onSave={handleSave}
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
