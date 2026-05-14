import React, { useState, useMemo } from "react";
import { useListTransactions, useConfirmTransaction, useListUsers } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatDate } from "@/lib/format";
import { Loader2, Search, CheckCircle2, Clock, Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const TYPE_COLORS: Record<string, string> = {
  deposit: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  withdrawal: "bg-red-500/20 text-red-400 border-red-500/30",
};
const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};
const TYPE_LABELS: Record<string, string> = { deposit: "구매", withdrawal: "출금" };
const STATUS_LABELS: Record<string, string> = { success: "완료", failed: "실패", pending: "확인대기" };

function StoreHierarchy({ storeName, agencyName, distributorName, hqName, userRole }: {
  storeName: string | null | undefined;
  agencyName: string | null | undefined;
  distributorName: string | null | undefined;
  hqName: string | null | undefined;
  userRole: string;
}) {
  if (!storeName) return <span className="text-muted-foreground">-</span>;

  const breadcrumbs: string[] = [];
  if (userRole === "superadmin" || userRole === "hq") {
    if (hqName) breadcrumbs.push(hqName);
    if (distributorName) breadcrumbs.push(distributorName);
    if (agencyName) breadcrumbs.push(agencyName);
  } else if (userRole === "distributor") {
    if (agencyName) breadcrumbs.push(agencyName);
  }

  return (
    <div className="min-w-0">
      <div className="font-medium text-sm truncate">{storeName}</div>
      {breadcrumbs.length > 0 && (
        <div className="text-[10px] text-muted-foreground truncate">{breadcrumbs.join(" › ")}</div>
      )}
    </div>
  );
}

function PendingDeposits() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const params: Record<string, unknown> = { type: "deposit", status: "pending", limit: 50 };
  if (user?.role === "store") params.storeId = user.id;

  const { data, isLoading, refetch } = useListTransactions(params as Parameters<typeof useListTransactions>[0]);
  const confirmMutation = useConfirmTransaction();

  const handleConfirm = async (id: number) => {
    setConfirmingId(id);
    try {
      await confirmMutation.mutateAsync({ id });
      toast({ title: "구매 확인 완료" });
      void refetch();
      void queryClient.invalidateQueries();
    } catch {
      toast({ title: "처리 실패", variant: "destructive" });
    } finally {
      setConfirmingId(null);
    }
  };

  const items = data?.items ?? [];

  return (
    <Card className="bg-card/50 border-yellow-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-yellow-400" />
          구매 확인 대기
          {items.length > 0 && (
            <Badge variant="outline" className="ml-1 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
              {items.length}건
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">확인 대기 중인 구매 신청이 없습니다</div>
        ) : (
          <>
            <div className="md:hidden divide-y divide-border/30">
              {items.map((t) => (
                <div key={t.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</p>
                      <p className="font-semibold mt-0.5">{t.memberName ?? "-"}</p>
                      {t.storeName && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building2 className="h-3 w-3" />{t.storeName}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">구매금액</p>
                      <p className="font-bold text-primary text-lg">{formatMoney(t.originalAmount)}</p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono flex gap-2 flex-wrap">
                    <span className="text-muted-foreground/60">구매자</span>
                    <span>{t.fromAccount}</span>
                    <span>→</span>
                    <span className="text-muted-foreground/60">가상계좌</span>
                    <span>{t.toAccount}</span>
                  </div>
                  <Button onClick={() => void handleConfirm(t.id)} disabled={confirmingId === t.id}
                    className="w-full bg-green-600 hover:bg-green-700 text-white h-8 text-xs">
                    {confirmingId === t.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />구매 확인</>}
                  </Button>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>추적번호</TableHead>
                    <TableHead>회원명</TableHead>
                    {user?.role !== "store" && <TableHead>매장</TableHead>}
                    <TableHead>구매자 계좌</TableHead>
                    <TableHead>가상계좌</TableHead>
                    <TableHead className="text-right">구매금액</TableHead>
                    <TableHead>구매일시</TableHead>
                    <TableHead className="text-center">처리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => (
                    <TableRow key={t.id} className="border-border/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</TableCell>
                      <TableCell>{t.memberName ?? "-"}</TableCell>
                      {user?.role !== "store" && (
                        <TableCell>
                          <StoreHierarchy
                            storeName={t.storeName}
                            agencyName={t.agencyName}
                            distributorName={t.distributorName}
                            hqName={t.hqName}
                            userRole={user?.role ?? ""}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">{t.fromAccount}</TableCell>
                      <TableCell className="font-mono text-xs">{t.toAccount}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{formatMoney(t.originalAmount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(t.createdAt)}</TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" onClick={() => void handleConfirm(t.id)} disabled={confirmingId === t.id}
                          className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs px-3">
                          {confirmingId === t.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />구매 확인</>}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OrgFilterDropdown({
  orgRole, label, value, onChange,
}: {
  orgRole: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data } = useListUsers({ role: orgRole, limit: 200 } as Parameters<typeof useListUsers>[0]);
  const items = data?.items ?? [];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-w-[130px]">
        <SelectValue placeholder={`${label} 선택`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">전체 {label}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.id} value={String(item.id)}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Transactions() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [page, setPage] = useState(1);

  const subOrgConfig = useMemo(() => {
    if (!user || user.role === "store" || user.role === "agency") return null;
    if (user.role === "distributor") return { role: "agency", label: "대리점", param: "agencyId" as const };
    return { role: "distributor", label: "총판", param: "distributorId" as const };
  }, [user?.role]);

  const storeFilterConfig = useMemo(() => {
    if (!user || user.role === "store") return null;
    if (user.role === "agency") return { role: "store", label: "매장", param: "storeId" as const };
    return null;
  }, [user?.role]);

  const queryParams = useMemo(() => {
    const p: Record<string, unknown> = {
      search: search || undefined,
      type: type === "all" ? undefined : type,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      limit: 20,
    };
    if (orgFilter !== "all") {
      if (subOrgConfig) p[subOrgConfig.param] = Number(orgFilter);
      else if (storeFilterConfig) p[storeFilterConfig.param] = Number(orgFilter);
    }
    return p;
  }, [search, type, startDate, endDate, page, orgFilter, subOrgConfig, storeFilterConfig]);

  const { data, isLoading } = useListTransactions(queryParams as Parameters<typeof useListTransactions>[0]);
  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  const handleOrgChange = (v: string) => { setOrgFilter(v); setPage(1); };

  const showStoreCol = user?.role !== "store";
  const colSpan = showStoreCol ? 11 : 10;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">구매 내역</h1>

      <PendingDeposits />

      {/* Filters */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="추적번호 / 계좌 검색"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="deposit">구매</SelectItem>
              <SelectItem value="withdrawal">출금</SelectItem>
            </SelectContent>
          </Select>

          {/* 조직 필터 (역할에 따라 표시) */}
          {subOrgConfig && (
            <OrgFilterDropdown
              orgRole={subOrgConfig.role}
              label={subOrgConfig.label}
              value={orgFilter}
              onChange={handleOrgChange}
            />
          )}
          {storeFilterConfig && (
            <OrgFilterDropdown
              orgRole={storeFilterConfig.role}
              label={storeFilterConfig.label}
              value={orgFilter}
              onChange={handleOrgChange}
            />
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" className="w-36 md:w-40" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
            <span className="text-muted-foreground text-sm">~</span>
            <Input type="date" className="w-36 md:w-40" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
          </div>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : data?.items.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-10 text-center text-muted-foreground text-sm">구매 내역이 없습니다</CardContent>
          </Card>
        ) : data?.items.map((t) => (
          <Card key={t.id} className="bg-card/50 border-border/50">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</p>
                  <p className="font-semibold mt-0.5">{t.memberName ?? "-"}</p>
                  {showStoreCol && t.storeName && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        {t.storeName}
                        {t.agencyName && ` · ${t.agencyName}`}
                        {t.distributorName && ` · ${t.distributorName}`}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Badge variant="outline" className={`text-xs ${TYPE_COLORS[t.type] ?? ""}`}>
                    {TYPE_LABELS[t.type] ?? t.type}
                  </Badge>
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[t.status] ?? ""}`}>
                    {STATUS_LABELS[t.status] ?? t.status}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">구매금액</p>
                  <p>{formatMoney(t.originalAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">수취금액</p>
                  <p className="font-bold text-primary">{formatMoney(t.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">수수료</p>
                  <p className="text-muted-foreground">{formatMoney(t.fee)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground font-mono">{formatDate(t.createdAt)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead>추적번호</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>회원명</TableHead>
                  {showStoreCol && <TableHead>매장 / 소속</TableHead>}
                  <TableHead>구매자 계좌</TableHead>
                  <TableHead>가상계좌</TableHead>
                  <TableHead className="text-right">구매금액</TableHead>
                  <TableHead className="text-right">수취금액</TableHead>
                  <TableHead className="text-right">수수료</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>일시</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((t) => (
                  <TableRow key={t.id} className="border-border/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.trackingNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${TYPE_COLORS[t.type] ?? ""}`}>
                        {TYPE_LABELS[t.type] ?? t.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{t.memberName ?? "-"}</TableCell>
                    {showStoreCol && (
                      <TableCell className="max-w-[160px]">
                        <StoreHierarchy
                          storeName={t.storeName}
                          agencyName={t.agencyName}
                          distributorName={t.distributorName}
                          hqName={t.hqName}
                          userRole={user?.role ?? ""}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">{t.fromAccount}</TableCell>
                    <TableCell className="font-mono text-xs">{t.toAccount}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(t.originalAmount)}</TableCell>
                    <TableCell className="text-right font-bold text-primary">{formatMoney(t.amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatMoney(t.fee)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[t.status] ?? ""}`}>
                        {STATUS_LABELS[t.status] ?? t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="text-center py-10 text-muted-foreground">
                      구매 내역이 없습니다
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>이전</Button>
          <span className="text-sm text-muted-foreground self-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>다음</Button>
        </div>
      )}
    </div>
  );
}
