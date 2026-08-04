import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
  enabled: boolean;
  verifiedAt: string | null;
};

export function MfaEnrollmentCard() {
  const { token, signOut } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "요청 처리에 실패했습니다.");
    return body;
  };

  useEffect(() => {
    if (!token) return;
    void request<Settings>("/otp/settings").then(setSettings).catch((error) => {
      setMessage(error instanceof Error ? error.message : "OTP 상태를 확인하지 못했습니다.");
    });
  }, [token]);

  const enroll = async () => {
    setPending(true);
    setMessage(null);
    try {
      const result = await request<{ secret: string }>("/otp/enroll", { method: "POST" });
      setSecret(result.secret);
      setMessage("인증 앱에 시크릿 키를 등록한 뒤 6자리 코드를 입력하세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OTP 등록을 시작하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const verify = async () => {
    setPending(true);
    setMessage(null);
    try {
      await request("/otp/verify-enrollment", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setMessage("OTP가 활성화되었습니다. 보안을 위해 다시 로그인합니다.");
      setTimeout(() => signOut(), 800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OTP 코드를 확인하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          관리자 OTP
        </CardTitle>
        <CardDescription>
          로그인과 출금 승인에 Google Authenticator 호환 6자리 코드를 사용합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings?.enabled ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600">
            <ShieldCheck className="h-4 w-4" />
            OTP가 활성화되어 있습니다.
          </div>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => void enroll()} disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              OTP 등록 시작
            </Button>
            {secret ? (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="mb-1 text-xs text-muted-foreground">인증 앱 수동 입력 시크릿</p>
                  <code className="break-all text-sm tracking-wider">{secret}</code>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mfa-code">OTP 코드</Label>
                  <div className="flex gap-2">
                    <Input
                      id="mfa-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="6자리"
                    />
                    <Button type="button" onClick={() => void verify()} disabled={pending || code.length !== 6}>
                      확인
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
