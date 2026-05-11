import React from "react";
import { useGetStatisticsOverview } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Users,
  Wallet,
  Activity,
  AlertCircle,
  TrendingUp,
  CreditCard,
} from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetStatisticsOverview();

  if (isLoading || !stats) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-32 bg-muted rounded-lg border border-border" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "오늘 입금",
      value: formatMoney(stats.todayDeposit),
      icon: ArrowRightLeft,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      title: "오늘 출금",
      value: formatMoney(stats.todayWithdrawal),
      icon: ArrowDownToLine,
      color: "text-red-400",
      bg: "bg-red-400/10",
    },
    {
      title: "오늘 수수료",
      value: formatMoney(stats.todayFee),
      icon: Activity,
      color: "text-green-400",
      bg: "bg-green-400/10",
    },
    {
      title: "대기 출금",
      value: `${stats.pendingWithdrawals}건`,
      icon: AlertCircle,
      color: "text-yellow-400",
      bg: "bg-yellow-400/10",
    },
    {
      title: "이달 입금",
      value: formatMoney(stats.monthDeposit),
      icon: TrendingUp,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      title: "이달 출금",
      value: formatMoney(stats.monthWithdrawal),
      icon: Wallet,
      color: "text-red-400",
      bg: "bg-red-400/10",
    },
    {
      title: "활성 가상계좌",
      value: `${stats.activeVirtualAccounts}개`,
      icon: CreditCard,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      title: "전체 회원",
      value: `${stats.totalMembers}명`,
      icon: Users,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">대시보드</h1>
        <p className="text-muted-foreground mt-1">플랫폼 현황 및 일별 통계 요약</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <Card key={i} className="bg-card/50 border-border/50 hover:border-border transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`p-2 rounded-md ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
