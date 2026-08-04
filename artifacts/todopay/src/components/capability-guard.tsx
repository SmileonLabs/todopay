import type { ReactNode } from "react";
import type { Capability } from "@/lib/access-control";
import { can } from "@/lib/access-control";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CapabilityGuard({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (can(user, capability)) return <>{children}</>;
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle>접근 권한 안내</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        현재 계정에는 이 기능을 사용할 권한이 없습니다.
      </CardContent>
    </Card>
  );
}
