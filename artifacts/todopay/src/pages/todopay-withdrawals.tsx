import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { TodoPayGuard } from "@/components/todopay-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { useTodoPayQuery, type Page, type TodoPayWithdrawal } from "@/lib/todopay-api";

function maskAccount(value?: string) {
  if (!value || value.length < 7) return value ?? "-";
  return `${value.slice(0, 3)}${"*".repeat(Math.max(4, value.length - 6))}${value.slice(-3)}`;
}

function WithdrawalsContent() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "50" });
    if (search) params.set("search", search);
    return `/withdrawals?${params}`;
  }, [search]);
  const list = useTodoPayQuery<Page<TodoPayWithdrawal>>(query);
  const detail = useTodoPayQuery<TodoPayWithdrawal>(`/withdrawals/${encodeURIComponent(selected ?? "")}`, { enabled: Boolean(selected) });

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold">출금 관리</h1><p className="mt-1 text-sm text-muted-foreground">승인 상태와 PG 지급 상태를 분리해 표시합니다.</p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">검색</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="추적번호 또는 PG 거래번호" onKeyDown={(event) => event.key === "Enter" && setSearch(searchInput.trim())} />
          <Button onClick={() => setSearch(searchInput.trim())}><Search className="mr-2 h-4 w-4" />조회</Button>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0"><div className="divide-y divide-border">
        {(list.data?.items ?? []).map((item) => {
          const open = selected === item.trackingNumber;
          return <div key={item.trackingNumber}>
            <button className="grid w-full gap-2 p-4 text-left hover:bg-muted/30 md:grid-cols-[1.4fr_.8fr_.8fr_.8fr_auto]" onClick={() => setSelected(open ? null : item.trackingNumber)}>
              <div><p className="font-mono text-xs text-muted-foreground">{item.trackingNumber}</p><p className="mt-1 text-sm">{formatDate(item.createdAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">신청금액</p><p className="font-semibold">{formatMoney(item.amount)}</p></div>
              <div><p className="text-xs text-muted-foreground">승인상태</p><Badge variant="outline">{item.approvalStatus}</Badge></div>
              <div><p className="text-xs text-muted-foreground">지급상태</p><Badge variant="outline">{item.payoutStatus}</Badge></div>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {open && <div className="border-t border-border/50 bg-muted/20 p-4 text-sm">
              {detail.isLoading ? <p>상세 정보를 불러오는 중입니다.</p> : <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p><span className="text-muted-foreground">실지급액:</span> {formatMoney(detail.data?.payoutAmount)}</p>
                  <p><span className="text-muted-foreground">수수료:</span> {formatMoney(detail.data?.fee)}</p>
                  <p><span className="text-muted-foreground">출금계좌:</span> {detail.data?.accountBank ?? "-"} {maskAccount(detail.data?.accountNumber)}</p>
                  <p><span className="text-muted-foreground">PG 결과:</span> {detail.data?.providerResultCode ?? "-"} {detail.data?.providerResultMessage ?? ""}</p>
                </div>
                <div><p className="mb-2 font-medium">PG 이벤트 타임라인</p>
                  {(detail.data?.events ?? []).length === 0 ? <p className="text-muted-foreground">수신된 이벤트가 없습니다.</p> :
                    detail.data?.events?.map((event) => <p key={`${event.eventId}-${event.eventType}`} className="border-l-2 border-primary/40 py-1 pl-3">{event.eventType} · {formatDate(event.processedAt)}</p>)}
                </div>
              </div>}
            </div>}
          </div>;
        })}
        {!list.isLoading && (list.data?.items.length ?? 0) === 0 && <p className="p-10 text-center text-muted-foreground">출금 내역이 없습니다.</p>}
      </div></CardContent></Card>
    </div>
  );
}

export default function TodoPayWithdrawals() {
  return <TodoPayGuard><WithdrawalsContent /></TodoPayGuard>;
}
