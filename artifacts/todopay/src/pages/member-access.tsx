import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Landmark, Loader2 } from "lucide-react";
import logo from "@/assets/todopay-logo-white.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REGISTRATION_STATE_KEY = "sellink_member_registration";
const baseUrl = import.meta.env.BASE_URL ?? "/";
const api = (path: string) => `${baseUrl}${path}`.replace(/\/+/g, "/").replace(":/", "://");

const BANKS = [
  { code: "004", name: "KB국민은행" },
  { code: "088", name: "신한은행" },
  { code: "020", name: "우리은행" },
  { code: "081", name: "하나은행" },
  { code: "003", name: "IBK기업은행" },
  { code: "011", name: "NH농협은행" },
  { code: "090", name: "카카오뱅크" },
  { code: "092", name: "토스뱅크" },
];

type RegistrationState = {
  registrationId: string;
  registrationToken: string;
  expiresAt: string;
};

type RegistrationResult = {
  status: string;
  expiresAt?: string | null;
  attemptsRemaining?: number;
  virtualAccount?: { id: number; bankName: string; accountNumber: string; status: string } | null;
  error?: string;
};

async function body<T>(response: Response): Promise<T & { error?: string }> {
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    return await response.json() as T & { error?: string };
  }
  return { error: `요청 처리 중 오류가 발생했습니다. (${response.status})` } as T & { error?: string };
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
      <AlertCircle className="h-4 w-4 shrink-0" /> {message}
    </div>
  );
}

export default function MemberAccess() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [login, setLogin] = useState({ loginId: "", password: "" });
  const [registration, setRegistration] = useState({
    storeCode: "",
    loginId: "",
    password: "",
    name: "",
    phone: "",
    birthdate: "",
    withdrawBankCode: BANKS[0].code,
    withdrawAccount: "",
  });
  const [registrationState, setRegistrationState] = useState<RegistrationState | null>(() => {
    try {
      const value = sessionStorage.getItem(REGISTRATION_STATE_KEY);
      return value ? JSON.parse(value) as RegistrationState : null;
    } catch {
      return null;
    }
  });
  const [issuedAccount, setIssuedAccount] = useState<RegistrationResult["virtualAccount"]>(null);
  const [code, setCode] = useState("");
  const [storeValid, setStoreValid] = useState<boolean | null>(null);
  const [storeName, setStoreName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  const secondsRemaining = useMemo(() => registrationState
    ? Math.max(0, Math.ceil((new Date(registrationState.expiresAt).getTime() - now) / 1000))
    : 0, [registrationState, now]);
  const step = issuedAccount ? 3 : registrationState ? 2 : 1;

  useEffect(() => {
    if (!registrationState) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [registrationState]);

  useEffect(() => {
    if (!registrationState) return;
    fetch(api(`api/member/registrations/${registrationState.registrationId}`), {
      headers: { "X-Registration-Token": registrationState.registrationToken },
    }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as RegistrationResult;
      if (result.status === "issued" && result.virtualAccount) {
        setIssuedAccount(result.virtualAccount);
        sessionStorage.removeItem(REGISTRATION_STATE_KEY);
      }
    }).catch(() => undefined);
  }, [registrationState]);

  const checkStore = async (storeCode: string) => {
    setRegistration((previous) => ({ ...previous, storeCode }));
    if (!storeCode.trim()) {
      setStoreValid(null);
      setStoreName("");
      return;
    }
    try {
      const response = await fetch(api(`api/member/store-check?code=${encodeURIComponent(storeCode)}`));
      const result = await response.json() as { valid: boolean; storeName?: string };
      setStoreValid(result.valid);
      setStoreName(result.valid ? result.storeName ?? "" : "");
    } catch {
      setStoreValid(null);
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(api("api/member/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login),
      });
      const result = await body<object>(response);
      if (!response.ok) {
        setError(result.error ?? "로그인에 실패했습니다.");
        return;
      }
      window.location.assign(api("member/portal"));
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const startRegistration = async (event: FormEvent) => {
    event.preventDefault();
    if (!storeValid) {
      setError("유효한 매장 코드를 확인해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(api("api/member/registrations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registration),
      });
      const result = await body<RegistrationState>(response);
      if (!response.ok || !result.registrationId || !result.registrationToken) {
        setError(result.error ?? "1원 인증을 시작하지 못했습니다.");
        return;
      }
      const state = result as RegistrationState;
      sessionStorage.setItem(REGISTRATION_STATE_KEY, JSON.stringify(state));
      setRegistrationState(state);
      setNow(Date.now());
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const confirmRegistration = async (event: FormEvent) => {
    event.preventDefault();
    if (!registrationState || !/^\d{4}$/.test(code)) {
      setError("1원 입금자명의 숫자 4자리를 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(api(`api/member/registrations/${registrationState.registrationId}/confirm`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Registration-Token": registrationState.registrationToken,
        },
        body: JSON.stringify({ code }),
      });
      const result = await body<RegistrationResult>(response);
      if (!response.ok || result.status !== "issued" || !result.virtualAccount) {
        setError(result.error ?? "인증번호를 확인하지 못했습니다.");
        return;
      }
      setIssuedAccount(result.virtualAccount);
      sessionStorage.removeItem(REGISTRATION_STATE_KEY);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const restart = async () => {
    if (registrationState && !issuedAccount) {
      await fetch(api(`api/member/registrations/${registrationState.registrationId}/cancel`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Registration-Token": registrationState.registrationToken,
        },
        body: "{}",
      }).catch(() => undefined);
    }
    sessionStorage.removeItem(REGISTRATION_STATE_KEY);
    setRegistrationState(null);
    setIssuedAccount(null);
    setCode("");
    setError("");
    setRegistration((previous) => ({ ...previous, loginId: "", password: "", withdrawAccount: "" }));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <img src={logo} alt="TodoPay" className="mx-auto h-auto w-56" />
          <p className="text-sm text-muted-foreground">가상계좌 구매 포털</p>
        </header>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/30 p-1">
          <button onClick={() => { setMode("login"); setError(""); }}
            className={`rounded-md py-2 ${mode === "login" ? "bg-card" : "text-muted-foreground"}`}>로그인</button>
          <button onClick={() => { setMode("register"); setError(""); }}
            className={`rounded-md py-2 ${mode === "register" ? "bg-card" : "text-muted-foreground"}`}>회원가입</button>
        </div>

        {mode === "login" ? (
          <Card><CardContent className="pt-6">
            <form onSubmit={(event) => void submitLogin(event)} className="space-y-4">
              <div><Label>아이디</Label><Input autoComplete="username" value={login.loginId}
                onChange={(event) => setLogin({ ...login, loginId: event.target.value })} /></div>
              <div><Label>비밀번호</Label><Input type="password" autoComplete="current-password" value={login.password}
                onChange={(event) => setLogin({ ...login, password: event.target.value })} /></div>
              {error && <ErrorBox message={error} />}
              <Button className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "로그인"}
              </Button>
            </form>
          </CardContent></Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">정식 본인인증 회원가입</CardTitle>
              <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
                {["정보 입력", "1원 인증", "발급 완료"].map((label, index) => (
                  <span key={label} className={step >= index + 1 ? "text-primary" : "text-muted-foreground"}>
                    {index + 1}. {label}
                  </span>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {step === 1 && (
                <form onSubmit={(event) => void startRegistration(event)} className="space-y-3">
                  <div><Label>매장 코드 *</Label><Input value={registration.storeCode}
                    onChange={(event) => void checkStore(event.target.value)} />
                    {storeValid === true && <p className="mt-1 text-xs text-green-400"><CheckCircle2 className="mr-1 inline h-3 w-3" />{storeName}</p>}
                    {storeValid === false && <p className="mt-1 text-xs text-red-400">유효하지 않은 매장 코드입니다.</p>}
                  </div>
                  <div><Label>아이디 *</Label><Input value={registration.loginId}
                    onChange={(event) => setRegistration({ ...registration, loginId: event.target.value })} /></div>
                  <div><Label>비밀번호 (8자 이상) *</Label><Input type="password" autoComplete="new-password" value={registration.password}
                    onChange={(event) => setRegistration({ ...registration, password: event.target.value })} /></div>
                  <div><Label>이름 *</Label><Input value={registration.name}
                    onChange={(event) => setRegistration({ ...registration, name: event.target.value })} /></div>
                  <div><Label>휴대폰 *</Label><Input inputMode="numeric" value={registration.phone}
                    onChange={(event) => setRegistration({ ...registration, phone: event.target.value.replace(/\D/g, "") })} placeholder="01012345678" /></div>
                  <div><Label>생년월일 *</Label><Input inputMode="numeric" value={registration.birthdate}
                    onChange={(event) => setRegistration({ ...registration, birthdate: event.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="YYYYMMDD" /></div>
                  <div><Label>1원을 받을 본인 은행 *</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3"
                      value={registration.withdrawBankCode}
                      onChange={(event) => setRegistration({ ...registration, withdrawBankCode: event.target.value })}>
                      {BANKS.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
                    </select>
                  </div>
                  <div><Label>본인 계좌번호 *</Label><Input inputMode="numeric" value={registration.withdrawAccount}
                    onChange={(event) => setRegistration({ ...registration, withdrawAccount: event.target.value.replace(/\D/g, "") })}
                    placeholder="- 없이 숫자만 입력" /></div>
                  <p className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-300">
                    입력한 본인 계좌로 1원이 송금됩니다. 입금자명에 표시된 숫자 4자리를 다음 화면에 입력하면 제주은행 가상계좌가 자동 발급됩니다.
                  </p>
                  {error && <ErrorBox message={error} />}
                  <Button className="w-full" disabled={loading || !storeValid}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "1원 인증 시작"}
                  </Button>
                </form>
              )}

              {step === 2 && registrationState && (
                <form onSubmit={(event) => void confirmRegistration(event)} className="space-y-4 text-center">
                  <Landmark className="mx-auto h-12 w-12 text-primary" />
                  <div><strong>본인 계좌의 1원 입금을 확인해 주세요.</strong>
                    <p className="mt-1 text-sm text-muted-foreground">입금자명에 표시된 숫자 4자리를 입력합니다.</p>
                  </div>
                  <Input className="text-center font-mono text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={4}
                    value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} />
                  <p className={secondsRemaining > 0 ? "text-sm text-muted-foreground" : "text-sm text-red-400"}>
                    {secondsRemaining > 0
                      ? `남은 시간 ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`
                      : "인증 시간이 만료되었습니다."}
                  </p>
                  {error && <ErrorBox message={error} />}
                  <Button className="w-full" disabled={loading || secondsRemaining === 0 || code.length !== 4}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "인증하고 가상계좌 발급"}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => void restart()}>가입 다시 시작</Button>
                </form>
              )}

              {step === 3 && issuedAccount && (
                <div className="space-y-4 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" />
                  <div><strong className="text-lg">회원가입과 가상계좌 발급이 완료되었습니다.</strong>
                    <p className="mt-2 font-mono text-primary">{issuedAccount.bankName} {issuedAccount.accountNumber}</p>
                  </div>
                  <Button className="w-full" onClick={() => {
                    setMode("login");
                    setLogin({ loginId: registration.loginId, password: "" });
                    setRegistrationState(null);
                    setIssuedAccount(null);
                  }}>로그인하기</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
