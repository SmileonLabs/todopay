import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import { TodoPayGuard } from "@/components/todopay-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { formatDate, formatMoney } from "@/lib/format";
import { useTodoPayQuery, type TodoPayBalance, type TodoPayFees } from "@/lib/todopay-api";

function BalanceContent() {
  const { user } = useAuth();
  const canViewMerchantContract = user?.role === "superadmin" || user?.role === "hq";
  const balance = useTodoPayQuery<TodoPayBalance>("/balance");
  const fees = useTodoPayQuery<TodoPayFees>("/fees", { enabled: canViewMerchantContract });
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold">잔액 및 정산 기준</h1><p className="mt-1 text-sm text-muted-foreground">셀링크 자체 계산값이 아닌 TodoPay 불변 원장 집계입니다.</p></div>
    <div className="grid gap-3 md:grid-cols-3">
      <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm text-muted-foreground">출금 가능 잔액</CardTitle><Wallet className="h-4 w-4 text-primary" /></CardHeader><CardContent><p className="text-2xl font-bold">{formatMoney(balance.data?.availableBalance)}</p></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm text-muted-foreground">누적 입금</CardTitle><ArrowUpRight className="h-4 w-4 text-green-400" /></CardHeader><CardContent><p className="text-2xl font-bold">{formatMoney(balance.data?.creditTotal)}</p></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm text-muted-foreground">누적 출금·예약</CardTitle><ArrowDownRight className="h-4 w-4 text-red-400" /></CardHeader><CardContent><p className="text-2xl font-bold">{formatMoney(balance.data?.debitTotal)}</p></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>{canViewMerchantContract ? "계약 수수료" : "원장 정보"}</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm md:grid-cols-4">
      {canViewMerchantContract && <>
        <div><p className="text-muted-foreground">입금 수수료</p><p className="font-semibold">{fees.data?.configured ? formatMoney(fees.data.depositFee) : "미설정"}</p></div>
        <div><p className="text-muted-foreground">출금 수수료</p><p className="font-semibold">{fees.data?.configured ? formatMoney(fees.data.withdrawalFee) : "미설정"}</p></div>
        <div><p className="text-muted-foreground">이용 수수료율</p><p className="font-semibold">{fees.data?.configured ? `${fees.data.usageFeeRate}%` : "미설정"}</p></div>
      </>}
      <div><p className="text-muted-foreground">원장 계산시각</p><p className="font-semibold">{formatDate(balance.data?.calculatedAt)}</p></div>
    </CardContent></Card>
  </div>;
}

export default function TodoPayBalancePage() {
  return <TodoPayGuard><BalanceContent /></TodoPayGuard>;
}
