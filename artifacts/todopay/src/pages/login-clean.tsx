import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function LoginClean() {
  const [, setLocation] = useLocation();
  const { signIn, user, isLoading } = useAuth();
  const { toast } = useToast();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isLoading && user) setLocation("/dashboard");
  }, [isLoading, setLocation, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password, otpCode: otpCode || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        otpRequired?: boolean;
        user?: import("@workspace/api-client-react").AdminUser;
      };
      if (!response.ok) {
        if (body.otpRequired) {
          setOtpRequired(true);
          throw new Error("OTP 앱의 6자리 코드를 입력하세요.");
        }
        throw new Error(body.error ?? `로그인에 실패했습니다. (HTTP ${response.status})`);
      }
      if (!body.user) throw new Error("로그인 응답이 올바르지 않습니다.");
      signIn(body.user);
      setLocation("/dashboard");
    } catch (error) {
      toast({
        title: "로그인 실패",
        description: error instanceof Error ? error.message : "아이디와 비밀번호를 확인하세요.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center text-white">
          <BrandWordmark className="h-auto w-72" />
        </div>
        <Card className="border-border/50 bg-card/50 shadow-2xl backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-center text-2xl">관리자 로그인</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="loginId">아이디</Label>
                <Input
                  id="loginId"
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  placeholder="superadmin"
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {otpRequired ? (
                <div className="space-y-2">
                  <Label htmlFor="otpCode" className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    OTP 코드
                  </Label>
                  <Input
                    id="otpCode"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ""))}
                    autoComplete="one-time-code"
                    placeholder="6자리"
                    required
                  />
                </div>
              ) : null}
              <Button type="submit" className="mt-6 w-full" disabled={pending}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                로그인
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} TodoPay Financial Operations. All rights reserved.
        </div>
      </div>
    </div>
  );
}
