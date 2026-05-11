import React from "react";
import { useGetOtpSettings, useUpdateOtpSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Otp() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useGetOtpSettings();
  const update = useUpdateOtpSettings();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["/api/otp/settings"] });

  const handleToggle = (key: "useOtpForDeposit" | "useOtpForWithdrawal", current: boolean) => {
    update.mutate({ data: { [key]: !current } }, {
      onSuccess: () => {
        toast({ title: `OTP ${!current ? "활성화" : "비활성화"} 완료` });
        invalidate();
      },
      onError: () => toast({ title: "변경 실패", variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">OTP 설정</h1>
        <p className="text-muted-foreground mt-1">입금·출금 처리 시 OTP 인증 사용 여부를 설정합니다</p>
      </div>

      <div className="space-y-4">
        {/* Deposit OTP */}
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-blue-500/10">
                  <KeyRound className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">입금 OTP 인증</h3>
                    <Badge variant="outline" className={`text-xs ${data?.useOtpForDeposit ? "border-green-500/30 text-green-400" : "border-slate-500/30 text-slate-400"}`}>
                      {data?.useOtpForDeposit ? "활성" : "비활성"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">입금 처리 시 OTP 코드 입력이 필요합니다</p>
                </div>
              </div>
              <Switch
                checked={data?.useOtpForDeposit ?? false}
                onCheckedChange={() => handleToggle("useOtpForDeposit", data?.useOtpForDeposit ?? false)}
                disabled={update.isPending}
              />
            </div>
          </CardContent>
        </Card>

        {/* Withdrawal OTP */}
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-orange-500/10">
                  <ShieldCheck className="h-6 w-6 text-orange-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">출금 OTP 인증</h3>
                    <Badge variant="outline" className={`text-xs ${data?.useOtpForWithdrawal ? "border-green-500/30 text-green-400" : "border-slate-500/30 text-slate-400"}`}>
                      {data?.useOtpForWithdrawal ? "활성" : "비활성"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">출금 승인 시 OTP 코드 입력이 필요합니다</p>
                </div>
              </div>
              <Switch
                checked={data?.useOtpForWithdrawal ?? false}
                onCheckedChange={() => handleToggle("useOtpForWithdrawal", data?.useOtpForWithdrawal ?? false)}
                disabled={update.isPending}
              />
            </div>
          </CardContent>
        </Card>

        {/* OTP Secret info */}
        {data?.otpSecret && (
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">OTP 시크릿 키</CardTitle>
              <CardDescription>TOTP 앱(Google Authenticator 등)에 등록하여 사용하세요</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-3 font-mono text-sm text-primary tracking-widest break-all">
                {data.otpSecret}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-card/50 border-border/50 border-yellow-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              ⚠ OTP를 활성화하면 해당 작업 시 TOTP 코드 입력이 필수가 됩니다. 
              OTP 앱이 준비된 상태에서 활성화하세요.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
