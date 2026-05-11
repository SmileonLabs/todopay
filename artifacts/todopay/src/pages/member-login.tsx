import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Landmark, CopyCheck, Copy, LogOut, ShieldCheck, Clock } from "lucide-react";

const MEMBER_TOKEN_KEY = "todopay_member_token";

interface MemberAccount {
  id: number;
  bankName: string;
  accountNumber: string;
  balance: string;
  status: string;
}

interface MemberInfo {
  id: number;
  loginId: string;
  name: string;
  phone: string;
  birthdate: string | null;
  isVerified: boolean;
  createdAt: string;
}

interface MemberSession {
  member: MemberInfo;
  account: MemberAccount | null;
}

function formatBalance(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return "0";
  return num.toLocaleString("ko-KR");
}

function Portal({ session, onLogout }: { session: MemberSession; onLogout: () => void }) {
  const { member, account } = session;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!account) return;
    navigator.clipboard.writeText(account.accountNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCopied(false));
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-primary tracking-tight">TodoPay</span>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            로그아웃
          </button>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="pt-6 pb-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{member.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{member.loginId}</p>
              </div>
              {member.isVerified && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  인증완료
                </div>
              )}
            </div>

            <div className="h-px bg-border/50" />

            {account ? (
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-5 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Landmark className="h-4 w-4" />
                  <span className="text-sm font-semibold">가상계좌</span>
                  {account.status === "revoked" && (
                    <span className="ml-auto text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">해지됨</span>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">은행</p>
                  <p className="font-semibold">{account.bankName}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">계좌번호</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-lg font-bold text-primary tracking-wider">
                      {account.accountNumber}
                    </p>
                    <button
                      onClick={handleCopy}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="복사"
                    >
                      {copied
                        ? <CopyCheck className="h-4 w-4 text-green-400" />
                        : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">잔액</p>
                  <p className="text-2xl font-bold">
                    {formatBalance(account.balance)}<span className="text-sm font-normal text-muted-foreground ml-1">원</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-muted/30 border border-border/50 p-5 text-center">
                <p className="text-sm text-muted-foreground">발급된 가상계좌가 없습니다</p>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              가입일: {new Date(member.createdAt).toLocaleDateString("ko-KR")}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 TodoPay Financial Operations. All rights reserved.
        </p>
      </div>
    </div>
  );
}

export default function MemberLogin() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<MemberSession | null>(null);
  const [checkingToken, setCheckingToken] = useState(true);

  const baseUrl = import.meta.env.BASE_URL ?? "/";
  const apiUrl = (path: string) =>
    `${baseUrl}${path}`.replace(/\/+/g, "/").replace(":/", "://");

  useEffect(() => {
    const token = localStorage.getItem(MEMBER_TOKEN_KEY);
    if (!token) { setCheckingToken(false); return; }
    fetch(apiUrl("api/member/auth/me"), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() as Promise<MemberSession> : Promise.reject())
      .then(data => setSession(data))
      .catch(() => localStorage.removeItem(MEMBER_TOKEN_KEY))
      .finally(() => setCheckingToken(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password) { setError("아이디와 비밀번호를 입력해주세요"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("api/member/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      const data = await res.json() as MemberSession & { token?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "로그인에 실패했습니다"); return; }
      if (data.token) localStorage.setItem(MEMBER_TOKEN_KEY, data.token);
      setSession({ member: data.member, account: data.account });
    } catch {
      setError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(MEMBER_TOKEN_KEY);
    setSession(null);
    setLoginId("");
    setPassword("");
  };

  if (checkingToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (session) {
    return <Portal session={session} onLogout={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight">TodoPay</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">회원 로그인</p>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="pt-6">
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="loginId" className="text-xs text-muted-foreground">아이디</Label>
                <Input
                  id="loginId"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value.replace(/\s/g, ""))}
                  placeholder="아이디 입력"
                  autoComplete="username"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs text-muted-foreground">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-black hover:bg-primary/90 font-semibold"
              >
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />로그인 중...</> : "로그인"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">아직 회원이 아니신가요?</p>
          <a
            href="/register/member"
            className="text-sm font-medium text-primary hover:text-primary/80 underline-offset-4 hover:underline transition-colors"
          >
            회원 가입하기
          </a>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 TodoPay Financial Operations. All rights reserved.
        </p>
      </div>
    </div>
  );
}
