import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { signIn, user, isLoading } = useAuth();
  const { toast } = useToast();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isLoading && user) {
      setLocation("/dashboard");
    }
  }, [user, isLoading, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? "로그인 실패");
      }

      const data = await res.json() as { token: string; user: import("@workspace/api-client-react").AdminUser };
      signIn(data.token, data.user);
      setLocation("/dashboard");
    } catch (err) {
      toast({
        title: "로그인 실패",
        description: err instanceof Error ? err.message : "아이디 또는 비밀번호를 확인해 주세요.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <img src={logo} alt="TodoPay" className="h-56 w-auto brightness-0 invert" />
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-2xl">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl text-center">관리자 로그인</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="loginId">아이디</Label>
                <Input
                  id="loginId"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="bg-background/50 focus-visible:ring-primary"
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
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/50 focus-visible:ring-primary"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={pending}
              >
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
