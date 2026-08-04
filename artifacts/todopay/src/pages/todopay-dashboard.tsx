import { Activity, ArrowDownToLine, CreditCard, RefreshCw, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TodoPayGuard } from "@/components/todopay-guard";
import { useAuth } from "@/contexts/auth-context";
import { formatDate, formatMoney } from "@/lib/format";
import {
  useTodoPayQuery,
  type IntegrationStatus,
  type TodoPayBalance,
  type TodoPayFees,
  type TodoPayMerchant,
  type TodoPayOverview,
} from "@/lib/todopay-api";

function DashboardContent() {
  const { user } = useAuth();
  const canViewMerchantContract = user?.role === "superadmin" || user?.role === "hq";
  const status = useTodoPayQuery<IntegrationStatus>("/status");
  const overview = useTodoPayQuery<TodoPayOverview>("/overview");
  const balance = useTodoPayQuery<TodoPayBalance>("/balance");
  const fees = useTodoPayQuery<TodoPayFees>("/fees", { enabled: canViewMerchantContract });
  const merchant = useTodoPayQuery<TodoPayMerchant>("/merchant", { enabled: canViewMerchantContract });
  const refreshing = status.isFetching || overview.isFetching || balance.isFetching || fees.isFetching || merchant.isFetching;
  const refresh = () => void Promise.all([
    status.refetch(),
    overview.refetch(),
    balance.refetch(),
    ...(canViewMerchantContract ? [fees.refetch(), merchant.refetch()] : []),
  ]);

  const cards = [
    { label: "오늘 입금", value: formatMoney(overview.data?.todayDeposits ?? 0), icon: CreditCard },
    { label: "출금 가능 잔액", value: formatMoney(balance.data?.availableBalance ?? 0), icon: Wallet },
    { label: "출금 승인 대기", value: `${overview.data?.pendingWithdrawals.count ?? 0}건`, icon: ArrowDownToLine },
    { label: "전체 회원", value: `${overview.data?.members ?? 0}명`, icon: Users },
  ];
  const integration = status.data?.integration;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">운영 대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">TodoPay 원장을 기준으로 실시간 금융 현황을 조회합니다.</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />새로고침
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{value}</div></CardContent>
          </Card>
        ))}
      </div>

      <div className={`grid gap-3 ${canViewMerchantContract ? "lg:grid-cols-2" : ""}`}>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />TodoPay 연동 상태</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="text-muted-foreground">API 인증</p><p className="font-medium text-green-400">정상</p></div>
            <div><p className="text-muted-foreground">PG 실거래</p><p className="font-medium">{integration?.paymentProviderEnabled ? "활성" : "비활성"}</p></div>
            {canViewMerchantContract && <>
              <div><p className="text-muted-foreground">가맹점 코드</p><p className="font-medium">{merchant.data?.code ?? "-"}</p></div>
              <div><p className="text-muted-foreground">가맹점 상태</p><p className="font-medium">{merchant.data?.status ?? "-"}</p></div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">API 호출 허용 IP</p>
                <p className="font-medium">{merchant.data?.allowedIps?.length ? merchant.data.allowedIps.join(", ") : "미등록"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">하위 시스템 Webhook</p>
                <p className="break-all font-medium">{merchant.data?.webhookUrl ?? "미등록 (실시간 하위 알림을 사용하지 않으면 선택사항)"}</p>
              </div>
            </>}
            <div><p className="text-muted-foreground">마지막 확인</p><p className="font-medium">{formatDate(integration?.checkedAt)}</p></div>
          </CardContent>
        </Card>
        {canViewMerchantContract && <Card>
          <CardHeader><CardTitle>TodoPay 계약 수수료</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div><p className="text-muted-foreground">입금 수수료</p><p className="font-semibold">{fees.data?.configured ? formatMoney(fees.data.depositFee) : "미설정"}</p></div>
            <div><p className="text-muted-foreground">출금 수수료</p><p className="font-semibold">{fees.data?.configured ? formatMoney(fees.data.withdrawalFee) : "미설정"}</p></div>
            <div><p className="text-muted-foreground">이용 수수료율</p><p className="font-semibold">{fees.data?.configured ? `${fees.data.usageFeeRate}%` : "미설정"}</p></div>
          </CardContent>
        </Card>}
      </div>
    </div>
  );
}

export default function TodoPayDashboard() {
  return <TodoPayGuard><DashboardContent /></TodoPayGuard>;
}
