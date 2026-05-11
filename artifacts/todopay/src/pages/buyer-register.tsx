import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Landmark, CopyCheck, Copy } from "lucide-react";

interface BuyerResult {
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

export default function BuyerRegister() {
  const [form, setForm] = useState({
    name: "",
    loginId: "",
    password: "",
    passwordConfirm: "",
    phone: "",
    birthdate: "",
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BuyerResult | null>(null);
  const [apiError, setApiError] = useState("");
  const [copied, setCopied] = useState(false);

  const validate = () => {
    const e: Partial<typeof form> = {};
    if (!form.name.trim()) e.name = "이름을 입력해주세요";
    if (!form.loginId.trim()) e.loginId = "아이디를 입력해주세요";
    else if (form.loginId.length < 4) e.loginId = "아이디는 4자 이상이어야 합니다";
    if (!form.password) e.password = "비밀번호를 입력해주세요";
    else if (form.password.length < 6) e.password = "비밀번호는 6자 이상이어야 합니다";
    if (form.password !== form.passwordConfirm) e.passwordConfirm = "비밀번호가 일치하지 않습니다";
    if (!form.phone.trim()) e.phone = "전화번호를 입력해주세요";
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) e.phone = "올바른 전화번호를 입력해주세요";
    if (!form.birthdate.trim()) e.birthdate = "생년월일을 입력해주세요";
    const bdDigits = form.birthdate.replace(/\D/g, "");
    if (bdDigits.length < 8) e.birthdate = "생년월일 8자리를 입력해주세요 (예: 1990-01-01)";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError("");
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${baseUrl}api/members`.replace(/\/+/g, "/").replace(":/", "://"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          loginId: form.loginId.trim(),
          password: form.password,
          phone: form.phone.replace(/\D/g, ""),
          birthdate: form.birthdate,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setApiError(data.error ?? "가입에 실패했습니다. 다시 시도해주세요.");
        return;
      }
      const data = await res.json() as BuyerResult;
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
    }).catch(() => {
      setCopied(false);
    });
  };

  const field = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  if (result) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <span className="text-2xl font-bold text-primary tracking-tight">TodoPay</span>
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
                    <p className="font-mono text-xl font-bold text-primary tracking-wider">
                      {result.virtualAccountNumber}
                    </p>
                    <button
                      onClick={handleCopy}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="복사"
                    >
                      {copied ? <CopyCheck className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground px-4">
                위 가상계좌로 입금하면 자동으로 처리됩니다.<br />
                아이디 <span className="font-mono font-medium text-foreground">{result.loginId}</span>로 서비스를 이용하실 수 있습니다.
              </p>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            © 2026 TodoPay Financial Operations. All rights reserved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight">TodoPay</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">회원 가입</p>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">기본 정보 입력</CardTitle>
            <p className="text-xs text-muted-foreground">가입 즉시 가상계좌가 발급됩니다</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs text-muted-foreground">
                  이름 <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="홍길동"
                  className={errors.name ? "border-red-500/50" : ""}
                />
                {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
              </div>

              {/* Login ID */}
              <div className="space-y-1.5">
                <Label htmlFor="loginId" className="text-xs text-muted-foreground">
                  아이디 <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="loginId"
                  value={form.loginId}
                  onChange={(e) => field("loginId", e.target.value.replace(/\s/g, ""))}
                  placeholder="영문·숫자 4자 이상"
                  className={errors.loginId ? "border-red-500/50" : ""}
                />
                {errors.loginId && <p className="text-xs text-red-400">{errors.loginId}</p>}
              </div>

              {/* Password */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs text-muted-foreground">
                    비밀번호 <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={(e) => field("password", e.target.value)}
                    placeholder="6자 이상"
                    className={errors.password ? "border-red-500/50" : ""}
                  />
                  {errors.password && <p className="text-xs text-red-400">{errors.password}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="passwordConfirm" className="text-xs text-muted-foreground">
                    비밀번호 확인 <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="passwordConfirm"
                    type="password"
                    value={form.passwordConfirm}
                    onChange={(e) => field("passwordConfirm", e.target.value)}
                    placeholder="재입력"
                    className={errors.passwordConfirm ? "border-red-500/50" : ""}
                  />
                  {errors.passwordConfirm && <p className="text-xs text-red-400">{errors.passwordConfirm}</p>}
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs text-muted-foreground">
                  전화번호 <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => field("phone", formatPhone(e.target.value))}
                  placeholder="010-0000-0000"
                  className={errors.phone ? "border-red-500/50" : ""}
                />
                {errors.phone && <p className="text-xs text-red-400">{errors.phone}</p>}
              </div>

              {/* Birthdate */}
              <div className="space-y-1.5">
                <Label htmlFor="birthdate" className="text-xs text-muted-foreground">
                  생년월일 <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="birthdate"
                  value={form.birthdate}
                  onChange={(e) => field("birthdate", formatBirthdate(e.target.value))}
                  placeholder="1990-01-01"
                  maxLength={10}
                  className={errors.birthdate ? "border-red-500/50" : ""}
                />
                {errors.birthdate && <p className="text-xs text-red-400">{errors.birthdate}</p>}
              </div>

              {apiError && (
                <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <p className="text-xs text-red-400">{apiError}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-black hover:bg-primary/90 font-semibold mt-2"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />처리 중...</>
                ) : (
                  "가입하기"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 TodoPay Financial Operations. All rights reserved.
        </p>
      </div>
    </div>
  );
}
