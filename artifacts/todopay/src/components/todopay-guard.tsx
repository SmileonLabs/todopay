import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTodoPayQuery, type IntegrationStatus } from "@/lib/todopay-api";
import { can, hasFinancialScope } from "@/lib/access-control";

export function TodoPayGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const canReadFinancialData = can(user, "financial.read");
  const financialScopeReady = hasFinancialScope(user);
  const status = useTodoPayQuery<IntegrationStatus>("/status", {
    enabled: canReadFinancialData && financialScopeReady,
    staleTime: 10_000,
  });

  if (!canReadFinancialData || !financialScopeReady) {
    return (
      <Card>
        <CardHeader><CardTitle>접근 권한 안내</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          조직·매장 식별자 매핑이 완료되기 전까지 TodoPay 금융 데이터는 슈퍼관리자에게만 제공됩니다.
        </CardContent>
      </Card>
    );
  }
  if (status.isLoading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (status.error || !status.data?.connected) {
    return (
      <Card className="border-red-500/40">
        <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-400" />TodoPay 연결 필요</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{status.data?.message ?? status.error?.message ?? "TodoPay API에 연결할 수 없습니다."}</p>
          <p>연결정보가 설정될 때까지 기존 셀링크 금융 쓰기 기능은 안전하게 차단됩니다.</p>
        </CardContent>
      </Card>
    );
  }
  return children;
}
