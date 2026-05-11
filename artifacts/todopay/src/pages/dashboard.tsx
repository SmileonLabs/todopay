import React from "react";
import { useGetStatisticsOverview } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { ArrowDownToLine, ArrowRightLeft, Users, Wallet, Activity, AlertCircle } from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetStatisticsOverview();

  if (isLoading || !stats) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted rounded-lg border border-border"></div>)}
        </div>
      </div>
    );
  }

  const statCards = [
    { title: "Today's Deposits", value: formatMoney(stats.todayDeposit), icon: ArrowRightLeft, color: "text-blue-400" },
    { title: "Today's Withdrawals", value: formatMoney(stats.todayWithdrawal), icon: ArrowDownToLine, color: "text-red-400" },
    { title: "Today's Fees", value: formatMoney(stats.todayFee), icon: Activity, color: "text-green-400" },
    { title: "Pending Withdrawals", value: stats.pendingWithdrawals.toString(), icon: AlertCircle, color: "text-yellow-400" },
    { title: "Monthly Deposits", value: formatMoney(stats.monthDeposit), icon: Wallet, color: "text-blue-400" },
    { title: "Monthly Withdrawals", value: formatMoney(stats.monthWithdrawal), icon: Wallet, color: "text-red-400" },
    { title: "Active Virtual Accounts", value: stats.activeVirtualAccounts.toString(), icon: Activity, color: "text-primary" },
    { title: "Total Members", value: stats.totalMembers.toString(), icon: Users, color: "text-purple-400" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">Daily platform statistics and summary.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <Card key={i} className="bg-card/50 border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
