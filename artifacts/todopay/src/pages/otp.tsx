import React, { useState } from "react";
import { customFetch, useGetOtpSettings, useUpdateOtpSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Enrollment = { secret: string; otpAuthUrl: string };

export default function Otp() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useGetOtpSettings();
  const update = useUpdateOtpSettings();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

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

  const startEnrollment = async () => {
    setWorking(true);
    try {
      const result = await customFetch<Enrollment>("/api/otp/enrollment", { method: "POST" });
      setEnrollment(result);
      setRecoveryCodes([]);
      toast({ title: "인증 앱에 등록한 뒤 6자리 코드를 확인해주세요" });
    } catch {
      toast({ title: "OTP 등록 시작 실패", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "6자리 OTP 코드를 입력해주세요", variant: "destructive" });
      return;
    }
    setWorking(true);
    try {
      const result = await customFetch<{ success: true; recoveryCodes: string[] }>(
        "/api/otp/enrollment/verify",
        { method: "POST", body: JSON.stringify({ code }), headers: { "Content-Type": "application/json" } },
      );
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setCode("");
      invalidate();
      toast({ title: "OTP 등록이 완료됐습니다" });
    } catch {
      toast({ title: "OTP 코드가 일치하지 않습니다", variant: "destructive" });
    } finally {
      setWorking(false);
    }
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
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              인증 앱 등록
            </CardTitle>
            <CardDescription>
              Google Authenticator, Microsoft Authenticator 등 표준 TOTP 앱을 사용합니다.
              시크릿 키는 등록 중 한 번만 표시되며 서버에는 암호화해 저장합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={data?.enrolled ? "text-green-400" : "text-slate-400"}>
                {data?.enrolled ? "등록 완료" : "미등록"}
              </Badge>
              {data?.verifiedAt && (
                <span className="text-xs text-muted-foreground">
                  확인: {new Date(data.verifiedAt).toLocaleString("ko-KR")}
                </span>
              )}
            </div>
            {!enrollment && (
              <Button onClick={startEnrollment} disabled={working} variant="outline">
                {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {data?.enrolled ? "OTP 다시 등록" : "OTP 등록 시작"}
              </Button>
            )}
            {enrollment && (
              <div className="space-y-3 rounded-lg border border-primary/30 p-4">
                <div>
                  <Label>수동 등록 시크릿</Label>
                  <div className="mt-1 break-all rounded bg-muted/40 p-3 font-mono tracking-wider">
                    {enrollment.secret}
                  </div>
                </div>
                <div>
                  <Label>등록 URI</Label>
                  <div className="mt-1 break-all rounded bg-muted/40 p-3 text-xs">
                    {enrollment.otpAuthUrl}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    placeholder="인증 앱의 6자리 코드"
                    className="max-w-56"
                  />
                  <Button onClick={verifyEnrollment} disabled={working || code.length !== 6}>
                    코드 확인
                  </Button>
                </div>
              </div>
            )}
            {recoveryCodes.length > 0 && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
                <p className="font-medium text-yellow-300">복구 코드를 안전한 곳에 보관하세요.</p>
                <p className="mb-3 text-xs text-muted-foreground">이 화면을 벗어나면 다시 표시되지 않습니다.</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {recoveryCodes.map(item => <span key={item}>{item}</span>)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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
                disabled={update.isPending || !data?.enrolled}
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
                disabled={update.isPending || !data?.enrolled}
              />
            </div>
          </CardContent>
        </Card>

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
