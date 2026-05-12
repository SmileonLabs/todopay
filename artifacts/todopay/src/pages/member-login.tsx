import React, { useState, useEffect, useCallback } from "react";
import logo from "@/assets/logo.png";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Landmark, CopyCheck, Copy, LogOut, ShieldCheck, Clock,
  ArrowDownCircle, History, Wallet, ChevronRight, AlertCircle, CheckCircle2,
} from "lucide-react";

const MEMBER_TOKEN_KEY = "todopay_member_token";
const BANKS = ["국민은행", "신한은행", "우리은행", "하나은행", "기업은행", "농협은행", "카카오뱅크", "토스뱅크"];

const baseUrl = import.meta.env.BASE_URL ?? "/";
const api = (path: string) => `${baseUrl}${path}`.replace(/\/+/g, "/").replace(":/", "://");

interface MemberAccount { id: number; bankName: string; accountNumber: string; balance: string; status: string; }
interface MemberInfo { id: number; loginId: string; name: string; phone: string; birthdate: string | null; isVerified: boolean; createdAt: string; }
interface MemberSession { member: MemberInfo; account: MemberAccount | null; }
interface DepositItem { id: number; amount: number; status: string; trackingNumber: string; fromAccount: string; toAccount: string; createdAt: string; }
interface DepositsResponse { balance: number; items: DepositItem[]; }

function fmt(n: number | string) { return Number(n).toLocaleString("ko-KR"); }
function fmtDate(s: string) { return new Date(s).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

const STATUS_LABEL: Record<string, string> = { pending: "대기중", success: "완료", failed: "실패" };
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  success: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

type Tab = "account" | "deposit" | "history";

function Portal({ session, token, onLogout }: { session: MemberSession; token: string; onLogout: () => void }) {
  const { member, account } = session;
  const [tab, setTab] = useState<Tab>("account");
  const [copied, setCopied] = useState(false);

  const [amount, setAmount] = useState("");
  const [fromBank, setFromBank] = useState(BANKS[0]);
  const [fromAccount, setFromAccount] = useState("");
  const [depositError, setDepositError] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState<DepositItem | null>(null);

  const [deposits, setDeposits] = useState<DepositsResponse | null>(null);
  const [depositsLoading, setDepositsLoading] = useState(false);

  const handleCopy = () => {
    if (!account) return;
    navigator.clipboard.writeText(account.accountNumber).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCopied(false));
  };

  const loadDeposits = useCallback(async () => {
    setDepositsLoading(true);
    try {
      const res = await fetch(api("api/member/deposits"), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setDeposits(await res.json() as DepositsResponse);
    } finally {
      setDepositsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (tab === "history") void loadDeposits();
  }, [tab, loadDeposits]);

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount.replace(/,/g, ""));
    if (!num || num <= 0) { setDepositError("입금액을 올바르게 입력해주세요"); return; }
    if (num < 1000) { setDepositError("최소 입금액은 1,000원입니다"); return; }
    if (!fromAccount.trim()) { setDepositError("출금 계좌번호를 입력해주세요"); return; }
    setDepositError("");
    setDepositLoading(true);
    try {
      const res = await fetch(api("api/member/deposit-request"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: num, fromBank, fromAccount: fromAccount.replace(/\D/g, "") }),
      });
      const data = await res.json() as DepositItem & { error?: string };
      if (!res.ok) { setDepositError(data.error ?? "신청에 실패했습니다"); return; }
      setDepositSuccess(data);
      setAmount("");
      setFromAccount("");
    } catch {
      setDepositError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setDepositLoading(false);
    }
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "account", label: "내 계좌", icon: <Wallet className="h-4 w-4" /> },
    { id: "deposit", label: "입금 신청", icon: <ArrowDownCircle className="h-4 w-4" /> },
    { id: "history", label: "거래 내역", icon: <History className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <img src={logo} alt="TodoPay" className="h-8 w-auto" />
          <button onClick={onLogout} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="h-3.5 w-3.5" />로그아웃
          </button>
        </div>

        <div className="flex items-center justify-between px-1">
          <div>
            <p className="font-bold">{member.name}</p>
            <p className="text-xs text-muted-foreground">{member.loginId}</p>
          </div>
          {member.isVerified && (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <ShieldCheck className="h-3.5 w-3.5" />인증완료
            </div>
          )}
        </div>

        <div className="flex rounded-lg bg-muted/30 p-1 gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-colors ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {tab === "account" && (
          <Card className="bg-card border-border/50">
            <CardContent className="pt-5 pb-5 space-y-4">
              {account ? (
                <>
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
                        <p className="font-mono text-lg font-bold text-primary tracking-wider">{account.accountNumber}</p>
                        <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors" title="복사">
                          {copied ? <CopyCheck className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">잔액</p>
                      <p className="text-2xl font-bold">{fmt(account.balance)}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setTab("deposit")}
                    className="w-full bg-primary text-black hover:bg-primary/90 font-semibold"
                  >
                    <ArrowDownCircle className="h-4 w-4 mr-2" />입금 신청하기<ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">발급된 가상계좌가 없습니다</div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />가입일: {new Date(member.createdAt).toLocaleDateString("ko-KR")}
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "deposit" && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ArrowDownCircle className="h-4 w-4 text-primary" />입금 신청
              </CardTitle>
              {account && (
                <p className="text-xs text-muted-foreground">
                  입금 계좌: <span className="font-mono text-foreground">{account.bankName} {account.accountNumber}</span>
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {depositSuccess ? (
                <div className="space-y-4">
                  <div className="rounded-xl bg-green-500/5 border border-green-500/20 p-5 space-y-3 text-center">
                    <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto" />
                    <p className="font-bold">입금 신청이 완료됐습니다</p>
                    <p className="text-sm text-muted-foreground">매장 담당자가 확인 후 처리해 드립니다</p>
                    <div className="text-left bg-muted/30 rounded-lg p-3 space-y-1.5 mt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">신청금액</span>
                        <span className="font-bold">{fmt(depositSuccess.amount)}원</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">추적번호</span>
                        <span className="font-mono text-xs">{depositSuccess.trackingNumber}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">상태</span>
                        <Badge variant="outline" className={`text-xs ${STATUS_CLASS.pending}`}>대기중</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setDepositSuccess(null)} className="flex-1">새 신청</Button>
                    <Button onClick={() => { setTab("history"); setDepositSuccess(null); }} className="flex-1 bg-primary text-black hover:bg-primary/90">내역 확인</Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={(e) => void handleDepositSubmit(e)} className="space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">입금액 <span className="text-red-400">*</span></Label>
                    <div className="relative">
                      <Input
                        value={amount}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, "").replace(/\D/g, "");
                          setAmount(raw ? Number(raw).toLocaleString("ko-KR") : "");
                        }}
                        placeholder="0"
                        className="pr-8 text-right font-mono text-lg"
                      />
                      <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {[10000, 30000, 50000, 100000].map(v => (
                        <button key={v} type="button" onClick={() => {
                          const prev = Number(amount.replace(/,/g, "")) || 0;
                          setAmount((prev + v).toLocaleString("ko-KR"));
                        }} className="text-xs px-2.5 py-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/50">
                          +{fmt(v)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">출금 은행</Label>
                    <select
                      value={fromBank}
                      onChange={(e) => setFromBank(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">출금 계좌번호 <span className="text-red-400">*</span></Label>
                    <Input
                      value={fromAccount}
                      onChange={(e) => setFromAccount(e.target.value.replace(/\D/g, ""))}
                      placeholder="- 없이 숫자만 입력"
                    />
                  </div>

                  {depositError && (
                    <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                      <p className="text-xs text-red-400">{depositError}</p>
                    </div>
                  )}

                  <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
                    <p className="text-xs text-blue-400">입금 신청 후 매장 담당자가 확인하면 가상계좌 잔액에 반영됩니다.</p>
                  </div>

                  <Button type="submit" disabled={depositLoading} className="w-full bg-primary text-black hover:bg-primary/90 font-semibold">
                    {depositLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />처리 중...</> : "입금 신청"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "history" && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />거래 내역
                </CardTitle>
                <button onClick={() => void loadDeposits()} className="text-xs text-muted-foreground hover:text-foreground transition-colors">새로고침</button>
              </div>
              {deposits && (
                <p className="text-xs text-muted-foreground">현재 잔액: <span className="font-bold text-foreground">{fmt(deposits.balance)}원</span></p>
              )}
            </CardHeader>
            <CardContent>
              {depositsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : !deposits?.items.length ? (
                <div className="text-center py-8 text-sm text-muted-foreground">거래 내역이 없습니다</div>
              ) : (
                <div className="space-y-2">
                  {deposits.items.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-primary">+{fmt(item.amount)}원</span>
                          <Badge variant="outline" className={`text-xs ${STATUS_CLASS[item.status] ?? ""}`}>
                            {STATUS_LABEL[item.status] ?? item.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.fromAccount}</p>
                        <p className="text-xs text-muted-foreground/60">{fmtDate(item.createdAt)}</p>
                      </div>
                      <p className="text-xs font-mono text-muted-foreground/60">{item.trackingNumber.slice(-8)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">© 2026 TodoPay Financial Operations. All rights reserved.</p>
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
  const [token, setToken] = useState<string>("");
  const [checkingToken, setCheckingToken] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(MEMBER_TOKEN_KEY);
    if (!saved) { setCheckingToken(false); return; }
    fetch(api("api/member/auth/me"), { headers: { Authorization: `Bearer ${saved}` } })
      .then(r => r.ok ? r.json() as Promise<MemberSession> : Promise.reject())
      .then(data => { setSession(data); setToken(saved); })
      .catch(() => localStorage.removeItem(MEMBER_TOKEN_KEY))
      .finally(() => setCheckingToken(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password) { setError("아이디와 비밀번호를 입력해주세요"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(api("api/member/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      const data = await res.json() as MemberSession & { token?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "로그인에 실패했습니다"); return; }
      if (data.token) { localStorage.setItem(MEMBER_TOKEN_KEY, data.token); setToken(data.token); }
      setSession({ member: data.member, account: data.account });
    } catch {
      setError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(MEMBER_TOKEN_KEY);
    setSession(null); setToken(""); setLoginId(""); setPassword("");
  };

  if (checkingToken) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  if (session) return <Portal session={session} token={token} onLogout={handleLogout} />;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <img src={logo} alt="TodoPay" className="h-16 w-auto" />
          <p className="text-xs text-muted-foreground uppercase tracking-widest">회원 로그인</p>
        </div>
        <Card className="bg-card border-border/50">
          <CardContent className="pt-6">
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="loginId" className="text-xs text-muted-foreground">아이디</Label>
                <Input id="loginId" value={loginId} onChange={(e) => setLoginId(e.target.value.replace(/\s/g, ""))} placeholder="아이디 입력" autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs text-muted-foreground">비밀번호</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 입력" autoComplete="current-password" />
              </div>
              {error && (
                <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}
              <Button type="submit" disabled={loading} className="w-full bg-primary text-black hover:bg-primary/90 font-semibold">
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />로그인 중...</> : "로그인"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">아직 회원이 아니신가요?</p>
          <a href="/register/member" className="text-sm font-medium text-primary hover:text-primary/80 underline-offset-4 hover:underline transition-colors">회원 가입하기</a>
        </div>
        <p className="text-center text-xs text-muted-foreground">© 2026 TodoPay Financial Operations. All rights reserved.</p>
      </div>
    </div>
  );
}
