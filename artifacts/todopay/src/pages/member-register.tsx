import React, { useState, useRef } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Landmark, CopyCheck, Copy, ChevronRight, ShieldCheck, AlertCircle } from "lucide-react";

const BANKS = ["국민은행", "신한은행", "우리은행", "하나은행", "기업은행", "농협은행", "카카오뱅크", "토스뱅크"];

interface MemberResult {
  name: string;
  loginId: string;
  virtualAccountBank: string;
  virtualAccountNumber: string;
  createdAt: string;
}

function formatBirthdate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const baseUrl = import.meta.env.BASE_URL ?? "/";
const apiUrl = (path: string) =>
  `${baseUrl}${path}`.replace(/\/+/g, "/").replace(":/", "://");

export default function MemberRegister() {
  const [step, setStep] = useState<1 | 2>(1);

  const [form, setForm] = useState({
    name: "",
    loginId: "",
    password: "",
    passwordConfirm: "",
    phone: "",
    birthdate: "",
    storeCode: "",
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});
  const [storeInfo, setStoreInfo] = useState<{ valid: boolean; storeName?: string } | null>(null);
  const [storeChecking, setStoreChecking] = useState(false);

  const [otpBank, setOtpBank] = useState(BANKS[0]);
  const [otpAccount, setOtpAccount] = useState("");
  const [otpAccountError, setOtpAccountError] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const mockCodeRef = useRef<string>("");
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MemberResult | null>(null);
  const [apiError, setApiError] = useState("");
  const [copied, setCopied] = useState(false);

  const field = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const checkStoreCode = async (code: string) => {
    if (!code.trim()) { setStoreInfo(null); return; }
    setStoreChecking(true);
    try {
      const res = await fetch(apiUrl(`api/member/store-check?code=${encodeURIComponent(code.trim())}`));
      const data = await res.json() as { valid: boolean; storeName?: string };
      setStoreInfo(data);
    } catch {
      setStoreInfo(null);
    } finally {
      setStoreChecking(false);
    }
  };

  const validateStep1 = () => {
    const e: Partial<typeof form> = {};
    if (!form.name.trim()) e.name = "이름을 입력해주세요";
    if (!form.loginId.trim()) e.loginId = "아이디를 입력해주세요";
    else if (form.loginId.length < 4) e.loginId = "아이디는 4자 이상이어야 합니다";
    if (!form.password) e.password = "비밀번호를 입력해주세요";
    else if (form.password.length < 6) e.password = "비밀번호는 6자 이상이어야 합니다";
    if (form.password !== form.passwordConfirm) e.passwordConfirm = "비밀번호가 일치하지 않습니다";
    if (!form.phone.trim()) e.phone = "전화번호를 입력해주세요";
    else if (form.phone.replace(/\D/g, "").length < 10) e.phone = "올바른 전화번호를 입력해주세요";
    if (!form.birthdate.trim()) e.birthdate = "생년월일을 입력해주세요";
    else if (form.birthdate.replace(/\D/g, "").length < 8) e.birthdate = "생년월일 8자리를 입력해주세요";
    if (!form.storeCode.trim()) e.storeCode = "매장코드를 입력해주세요";
    else if (!storeInfo?.valid) e.storeCode = "유효하지 않은 매장코드입니다";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNextStep = () => {
    if (validateStep1()) setStep(2);
  };

  const handleSendOtp = async () => {
    if (!otpAccount.replace(/\D/g, "")) { setOtpAccountError("계좌번호를 입력해주세요"); return; }
    setOtpAccountError("");
    setOtpSending(true);
    await new Promise(r => setTimeout(r, 1500));
    mockCodeRef.current = generateCode();
    setOtpSent(true);
    setOtpSending(false);
  };

  const handleSubmit = async () => {
    if (!otpSent) { setOtpError("먼저 인증번호를 발송해주세요"); return; }
    if (otpInput !== mockCodeRef.current) { setOtpError("인증번호가 일치하지 않습니다"); return; }
    setOtpError("");
    setLoading(true);
    setApiError("");
    try {
      const res = await fetch(apiUrl("api/members"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          loginId: form.loginId.trim(),
          password: form.password,
          phone: form.phone.replace(/\D/g, ""),
          birthdate: form.birthdate,
          storeCode: form.storeCode.trim(),
        }),
      });
      const data = await res.json() as MemberResult & { error?: string };
      if (!res.ok) { setApiError(data.error ?? "가입에 실패했습니다. 다시 시도해주세요."); return; }
      setResult(data);
    } catch {
      setApiError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.virtualAccountNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCopied(false));
  };

  if (result) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center">
            <div className="text-white">
              <BrandWordmark className="h-auto w-56" />
            </div>
          </div>
          <Card className="bg-card border-border/50">
            <CardContent className="pt-8 pb-8 flex flex-col items-center text-center space-y-6">
              <div className="h-16 w-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold mb-1">가입이 완료됐습니다</h2>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{result.name}</span>님 환영합니다
                </p>
              </div>
              <div className="w-full rounded-xl bg-primary/5 border border-primary/20 p-5 space-y-3">
                <div className="flex items-center gap-2 text-primary mb-1">
                  <Landmark className="h-4 w-4" />
                  <span className="text-sm font-semibold">발급된 가상계좌</span>
                </div>
                <div className="text-left space-y-1">
                  <p className="text-xs text-muted-foreground">은행</p>
                  <p className="font-semibold text-lg">{result.virtualAccountBank}</p>
                </div>
                <div className="text-left space-y-1">
                  <p className="text-xs text-muted-foreground">계좌번호</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xl font-bold text-primary tracking-wider">{result.virtualAccountNumber}</p>
                    <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors" title="복사">
                      {copied ? <CopyCheck className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground px-4">
                위 가상계좌로 입금하면 자동으로 처리됩니다.<br />
                아이디 <span className="font-mono font-medium text-foreground">{result.loginId}</span>로 서비스를 이용하실 수 있습니다.
              </p>
              <a href={`${baseUrl}member/login`.replace(/\/+/g, "/")} className="text-sm text-primary hover:text-primary/80 underline-offset-4 hover:underline transition-colors font-medium">
                로그인 하러가기
              </a>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground">© 2026 TodoPay Financial Operations. All rights reserved.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center gap-2">
          <div className="text-white">
            <BrandWordmark className="h-auto w-56" />
          </div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">회원 가입</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2].map((s) => (
            <React.Fragment key={s}>
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= s ? "bg-primary text-black" : "bg-muted text-muted-foreground"}`}>
                {s}
              </div>
              {s < 2 && <div className={`h-px w-10 transition-colors ${step > s ? "bg-primary" : "bg-border"}`} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">기본 정보 입력</CardTitle>
              <p className="text-xs text-muted-foreground">가입에 필요한 정보를 입력해주세요</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Store Code */}
                <div className="space-y-1.5">
                  <Label htmlFor="storeCode" className="text-xs text-muted-foreground">
                    매장코드 <span className="text-red-400">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="storeCode"
                      value={form.storeCode}
                      onChange={(e) => {
                        field("storeCode", e.target.value.replace(/\s/g, ""));
                        setStoreInfo(null);
                      }}
                      onBlur={(e) => void checkStoreCode(e.target.value)}
                      placeholder="매장에서 안내받은 코드"
                      className={errors.storeCode ? "border-red-500/50 pr-8" : storeInfo?.valid ? "border-green-500/50 pr-8" : "pr-8"}
                    />
                    {storeChecking && <Loader2 className="h-3.5 w-3.5 animate-spin absolute right-2.5 top-2.5 text-muted-foreground" />}
                    {!storeChecking && storeInfo?.valid && <CheckCircle2 className="h-3.5 w-3.5 absolute right-2.5 top-2.5 text-green-400" />}
                    {!storeChecking && storeInfo && !storeInfo.valid && <AlertCircle className="h-3.5 w-3.5 absolute right-2.5 top-2.5 text-red-400" />}
                  </div>
                  {storeInfo?.valid && <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{storeInfo.storeName}</p>}
                  {errors.storeCode && <p className="text-xs text-red-400">{errors.storeCode}</p>}
                </div>

                <div className="h-px bg-border/40" />

                {/* Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs text-muted-foreground">이름 <span className="text-red-400">*</span></Label>
                  <Input id="name" value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="홍길동" className={errors.name ? "border-red-500/50" : ""} />
                  {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
                </div>

                {/* Login ID */}
                <div className="space-y-1.5">
                  <Label htmlFor="loginId" className="text-xs text-muted-foreground">아이디 <span className="text-red-400">*</span></Label>
                  <Input id="loginId" value={form.loginId} onChange={(e) => field("loginId", e.target.value.replace(/\s/g, ""))} placeholder="영문·숫자 4자 이상" className={errors.loginId ? "border-red-500/50" : ""} />
                  {errors.loginId && <p className="text-xs text-red-400">{errors.loginId}</p>}
                </div>

                {/* Password */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs text-muted-foreground">비밀번호 <span className="text-red-400">*</span></Label>
                    <Input id="password" type="password" value={form.password} onChange={(e) => field("password", e.target.value)} placeholder="6자 이상" className={errors.password ? "border-red-500/50" : ""} />
                    {errors.password && <p className="text-xs text-red-400">{errors.password}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="passwordConfirm" className="text-xs text-muted-foreground">비밀번호 확인 <span className="text-red-400">*</span></Label>
                    <Input id="passwordConfirm" type="password" value={form.passwordConfirm} onChange={(e) => field("passwordConfirm", e.target.value)} placeholder="재입력" className={errors.passwordConfirm ? "border-red-500/50" : ""} />
                    {errors.passwordConfirm && <p className="text-xs text-red-400">{errors.passwordConfirm}</p>}
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs text-muted-foreground">전화번호 <span className="text-red-400">*</span></Label>
                  <Input id="phone" type="tel" value={form.phone} onChange={(e) => field("phone", formatPhone(e.target.value))} placeholder="010-0000-0000" className={errors.phone ? "border-red-500/50" : ""} />
                  {errors.phone && <p className="text-xs text-red-400">{errors.phone}</p>}
                </div>

                {/* Birthdate */}
                <div className="space-y-1.5">
                  <Label htmlFor="birthdate" className="text-xs text-muted-foreground">생년월일 <span className="text-red-400">*</span></Label>
                  <Input id="birthdate" value={form.birthdate} onChange={(e) => field("birthdate", formatBirthdate(e.target.value))} placeholder="1990-01-01" maxLength={10} className={errors.birthdate ? "border-red-500/50" : ""} />
                  {errors.birthdate && <p className="text-xs text-red-400">{errors.birthdate}</p>}
                </div>

                <Button onClick={handleNextStep} className="w-full bg-primary text-black hover:bg-primary/90 font-semibold mt-2">
                  다음 단계 <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                1원 인증
              </CardTitle>
              <p className="text-xs text-muted-foreground">본인 명의 계좌로 1원을 전송하여 인증합니다</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Bank select */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">은행 선택</Label>
                <select
                  value={otpBank}
                  onChange={(e) => setOtpBank(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Account number */}
              <div className="space-y-1.5">
                <Label htmlFor="otpAccount" className="text-xs text-muted-foreground">계좌번호 <span className="text-red-400">*</span></Label>
                <div className="flex gap-2">
                  <Input
                    id="otpAccount"
                    value={otpAccount}
                    onChange={(e) => setOtpAccount(e.target.value.replace(/\D/g, ""))}
                    placeholder="- 없이 숫자만 입력"
                    className={otpAccountError ? "border-red-500/50" : ""}
                    disabled={otpSent}
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSendOtp()}
                    disabled={otpSending || otpSent}
                    variant="outline"
                    className="whitespace-nowrap shrink-0"
                  >
                    {otpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : otpSent ? "발송완료" : "인증번호 발송"}
                  </Button>
                </div>
                {otpAccountError && <p className="text-xs text-red-400">{otpAccountError}</p>}
              </div>

              {/* Mock code display */}
              {otpSent && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-1">
                  <p className="text-xs text-yellow-400 font-medium">테스트 인증코드 (실제 환경에서는 앱에서 확인)</p>
                  <p className="text-xs text-muted-foreground">
                    {otpBank} {otpAccount} 계좌로 <span className="text-foreground font-semibold">1원</span>이 전송됐습니다.<br />
                    입금자명의 4자리 코드를 입력해주세요.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">테스트 코드:</span>
                    <span className="font-mono text-lg font-bold text-yellow-400 tracking-widest">{mockCodeRef.current}</span>
                  </div>
                </div>
              )}

              {/* Code input */}
              {otpSent && (
                <div className="space-y-1.5">
                  <Label htmlFor="otpInput" className="text-xs text-muted-foreground">입금자명 4자리 입력</Label>
                  <Input
                    id="otpInput"
                    value={otpInput}
                    onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setOtpError(""); }}
                    placeholder="0000"
                    maxLength={4}
                    className={`font-mono tracking-widest text-center text-lg ${otpError ? "border-red-500/50" : ""}`}
                  />
                  {otpError && <p className="text-xs text-red-400">{otpError}</p>}
                </div>
              )}

              {apiError && (
                <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <p className="text-xs text-red-400">{apiError}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">이전</Button>
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={loading || !otpSent}
                  className="flex-1 bg-primary text-black hover:bg-primary/90 font-semibold"
                >
                  {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />처리 중...</> : "가입 완료"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">© 2026 TodoPay Financial Operations. All rights reserved.</p>
      </div>
    </div>
  );
}
