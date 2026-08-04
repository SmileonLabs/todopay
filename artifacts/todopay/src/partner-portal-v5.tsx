import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Play,
  Save,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import Login from "@/pages/login-clean";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  PartnerLayout,
  type PartnerSection,
} from "@/components/partner-layout";
import { PartnerPayments } from "@/components/partner-payments";
import { MfaEnrollmentCard } from "@/components/mfa-enrollment-card";

type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  required: boolean;
};
type ActivityItem = {
  trackingNumber: string;
  status?: string;
  eventType?: string;
  provider?: string;
  amount?: number;
  updatedAt?: string;
  processedAt?: string;
};
type ApiTestResult = { status: number; body: string };
type WebhookDelivery = {
  eventId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  responseStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};
type WebhookDeliveries = {
  webhookUrl: string | null;
  secretVersion: number;
  items: WebhookDelivery[];
};
type Overview = {
  merchant: {
    id: number;
    code: string;
    name: string;
    status: string;
    webhookUrl: string | null;
    allowedIps: string[];
    apiKeyPrefix: string | null;
    dailyWithdrawalLimit: number;
    integrationStage: string;
  };
  integration: {
    apiKeyIssued: boolean;
    allowedIpCount: number;
    webhookConfigured: boolean;
    externalApiReady: boolean;
    paymentProviderEnabled: boolean;
    oneWonVerificationEnabled: boolean;
    virtualAccountEnabled: boolean;
    payoutEnabled: boolean;
    checklist: ChecklistItem[];
    warnings: string[];
  };
  summary: {
    memberCount: number;
    transactionCount: number;
    withdrawalCount: number;
    activeVirtualAccounts: number;
    awaitingVerificationCount: number;
    issuedVirtualAccountCount: number;
    recentWebhookEvents: number;
    deliveredWebhookCount: number;
    failedWebhookCount: number;
    todayDepositAmount: number;
  };
  fees: {
    configured: boolean;
    depositFee: number | null;
    withdrawalFee: number | null;
    usageFeeRate: number | null;
  };
};
type Activity = {
  webhookEvents: ActivityItem[];
  recentWithdrawals: ActivityItem[];
  recentTransactions: ActivityItem[];
};

const API_BASE_URL = "https://api.todopay.io/api/external/v1";

function formatMoney(value: number | null | undefined) {
  if (value == null) return "미설정";
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function stageLabel(stage: string) {
  switch (stage) {
    case "draft":
      return "초안";
    case "integration_pending":
      return "연동 설정 필요";
    case "test_ready":
      return "테스트 가능";
    case "live":
      return "운영 가능";
    case "suspended":
      return "정지";
    case "terminated":
      return "종료";
    case "pending":
      return "확인 대기";
    case "active":
      return "활성";
    default:
      return stage;
  }
}

function statusVariant(
  stage: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (stage === "live" || stage === "active") return "default";
  if (stage === "suspended" || stage === "terminated") return "destructive";
  if (
    stage === "draft" ||
    stage === "integration_pending" ||
    stage === "pending"
  )
    return "secondary";
  return "outline";
}

function isoLabel(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

function PartnerPortal() {
  const { user, token, signOut, isLoading } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [allowedIps, setAllowedIps] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [webhookDeliveries, setWebhookDeliveries] =
    useState<WebhookDeliveries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [testApiKey, setTestApiKey] = useState("");
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMemberLoginId, setTestMemberLoginId] = useState(
    () => `test_${Date.now().toString().slice(-8)}`,
  );
  const [testMemberName, setTestMemberName] = useState("API 테스트회원");
  const [activeSection, setActiveSection] =
    useState<PartnerSection>("dashboard");

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

      const body = (await response.json().catch(() => ({}))) as T & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "요청 처리에 실패했습니다.");
      }

      return body;
    },
    [token],
  );

  const load = async () => {
    if (!token) return;

    setLoading(true);
    try {
      const [overviewResult, activityResult, deliveryResult] = await Promise.all([
        request<Overview>("/partner/overview"),
        request<Activity>("/partner/activity"),
        request<WebhookDeliveries>("/partner/webhook-deliveries"),
      ]);
      setOverview(overviewResult);
      setActivity(activityResult);
      setWebhookDeliveries(deliveryResult);
      setWebhookUrl(overviewResult.merchant.webhookUrl ?? "");
      setAllowedIps(overviewResult.merchant.allowedIps.join(", "));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "가맹점 정보를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await request("/partner/settings", {
        method: "PATCH",
        body: JSON.stringify({
          webhookUrl,
          allowedIps: allowedIps
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "설정 저장에 실패했습니다.",
      );
    }
  };

  const rotateKey = async () => {
    if (
      !window.confirm("현재 API 키는 즉시 폐기됩니다. 새 API 키를 발급할까요?")
    )
      return;

    try {
      const result = await request<{ apiKey: string }>(
        "/partner/api-key/rotate",
        {
          method: "POST",
        },
      );
      setApiKey(result.apiKey);
      setTestApiKey(result.apiKey);
      setTestResult(null);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "API 키 발급에 실패했습니다.",
      );
    }
  };

  const rotateWebhookSecret = async () => {
    if (
      !window.confirm(
        "웹훅 서명 비밀키를 교체하면 수신 서버에도 새 키를 즉시 반영해야 합니다. 계속할까요?",
      )
    )
      return;

    try {
      const result = await request<{
        webhookSecret: string;
        secretVersion: number;
      }>("/partner/webhook-secret/rotate", { method: "POST" });
      setWebhookSecret(result.webhookSecret);
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "웹훅 서명 비밀키 교체에 실패했습니다.",
      );
    }
  };

  const sendWebhookTest = async () => {
    try {
      await request("/partner/webhook-test", { method: "POST" });
      window.setTimeout(() => void load(), 2500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "웹훅 테스트 전송에 실패했습니다.",
      );
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  };

  const callExternalApi = async (path: string, init?: RequestInit) => {
    if (!testApiKey.trim()) {
      throw new Error("테스트할 API 키를 입력해 주세요.");
    }

    const response = await fetch(`/api/external/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-TodoPay-Api-Key": testApiKey.trim(),
        ...(init?.headers ?? {}),
      },
    });

    const body = await response.text();
    setTestResult({ status: response.status, body });

    if (!response.ok) {
      throw new Error(`API가 HTTP ${response.status}로 응답했습니다.`);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      await callExternalApi("/merchant");
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "API 연결 테스트에 실패했습니다.",
      );
    } finally {
      setTesting(false);
    }
  };

  const testMemberCreate = async () => {
    if (
      !window.confirm(
        "테스트 회원 1건을 실제 가맹점 데이터에 생성합니다. 계속할까요?",
      )
    )
      return;

    setTesting(true);
    try {
      await callExternalApi("/members", {
        method: "POST",
        body: JSON.stringify({
          loginId: testMemberLoginId,
          password: "Testpass1234!",
          name: testMemberName,
          phone: "01000000000",
          email: `${testMemberLoginId}@example.invalid`,
        }),
      });
      setTestMemberLoginId(`test_${Date.now().toString().slice(-8)}`);
      await load();
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "테스트 회원 생성에 실패했습니다.",
      );
    } finally {
      setTesting(false);
    }
  };

  const curlExample = useMemo(
    () =>
      [
        `curl -X GET "${API_BASE_URL}/merchant"`,
        `  -H "X-TodoPay-Api-Key: ${apiKey ?? "발급받은_API_KEY"}"`,
      ].join(" \\\n"),
    [apiKey],
  );

  const currentUser = user as
    | (typeof user & { merchantId?: number | null })
    | null;

  if (isLoading) return <div className="min-h-screen bg-background" />;
  if (!currentUser) return <Login />;

  const displayUserName =
    currentUser.name && !currentUser.name.includes("?")
      ? currentUser.name
      : currentUser.loginId;

  return (
    <PartnerLayout
      activeSection={activeSection}
      integrationLabel={
        overview ? stageLabel(overview.merchant.integrationStage) : undefined
      }
      merchantCode={overview?.merchant.code}
      merchantName={overview?.merchant.name}
      onRefresh={() => void load()}
      onSectionChange={setActiveSection}
      onSignOut={signOut}
      refreshing={loading}
      userName={displayUserName}
    >
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {apiKey && activeSection === "settings" && (
        <Card className="border-amber-500">
          <CardHeader>
            <CardTitle>새 API 키</CardTitle>
            <CardDescription>
              이 키는 지금 한 번만 표시됩니다. 안전한 비밀 저장소에 즉시 보관해
              주세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block break-all rounded bg-muted p-3 text-sm">
              {apiKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy("api-key", apiKey)}
            >
              <Copy className="mr-2 h-4 w-4" />
              {copied === "api-key" ? "복사됨" : "API 키 복사"}
            </Button>
          </CardContent>
        </Card>
      )}

      {overview && (
        <>
          {activeSection === "dashboard" && (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold">가맹점 운영 현황</h1>
                  <Badge
                    variant={statusVariant(overview.merchant.integrationStage)}
                  >
                    {stageLabel(overview.merchant.integrationStage)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {overview.merchant.code} · TodoPay 파트너 계정 · merchantId{" "}
                  {currentUser.merchantId ?? "미연결"}
                </p>
              </div>

              {overview.integration.warnings.length > 0 && (
                <Card className="border-amber-500/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      운영 전 확인 필요
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {overview.integration.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="rounded-md bg-amber-500/10 px-3 py-2"
                      >
                        {warning}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardDescription>API 키 상태</CardDescription>
                    <CardTitle>
                      {overview.integration.apiKeyIssued
                        ? "발급 완료"
                        : "미발급"}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>허용 IP</CardDescription>
                    <CardTitle>
                      {overview.integration.allowedIpCount > 0
                        ? `${overview.integration.allowedIpCount}건 등록`
                        : "미설정"}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>Webhook URL</CardDescription>
                    <CardTitle>
                      {overview.integration.webhookConfigured
                        ? "설정 완료"
                        : "미설정"}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>외부 API 호출</CardDescription>
                    <CardTitle>
                      {overview.integration.externalApiReady ? "허용" : "차단"}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>연동 준비 체크리스트</CardTitle>
                  <CardDescription>
                    필수 항목이 완료되어야 API 연동과 운영 전환이 가능합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {overview.integration.checklist.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      {item.done ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                      )}
                      <div>
                        <p className="font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.done ? "완료" : item.required ? "필수" : "선택"}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          <Tabs value={activeSection} className="space-y-6">
            <TabsContent value="payments" className="space-y-6">
              <PartnerPayments
                active={activeSection === "payments"}
                request={request}
              />
            </TabsContent>

            <TabsContent value="settings" className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />
                    API 자격 증명
                  </CardTitle>
                  <CardDescription>
                    고객사 서버에서만 사용해야 하는 서버 간 연동 키입니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded bg-muted p-3 text-sm">
                    현재 키 접두어: {overview.merchant.apiKeyPrefix ?? "미발급"}
                  </div>
                  <div className="rounded bg-muted p-3 text-sm">
                    기본 주소: {API_BASE_URL}
                  </div>
                  <Button onClick={() => void rotateKey()}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    API 키 발급/교체
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    Webhook 및 접근 IP
                  </CardTitle>
                  <CardDescription>
                    실제 저장된 값만 표시합니다. 비어 있으면 미설정 상태입니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 rounded-md border p-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">
                        현재 Webhook URL:
                      </span>{" "}
                      {overview.merchant.webhookUrl ?? "미설정"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        현재 허용 IP:
                      </span>{" "}
                      {overview.merchant.allowedIps.length > 0
                        ? overview.merchant.allowedIps.join(", ")
                        : "미설정"}
                    </div>
                  </div>

                  <form className="space-y-4" onSubmit={saveSettings}>
                    <div>
                      <Label htmlFor="webhook">Webhook URL</Label>
                      <Input
                        id="webhook"
                        type="url"
                        value={webhookUrl}
                        onChange={(event) => setWebhookUrl(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="ips">허용 IP (쉼표로 구분)</Label>
                      <Input
                        id="ips"
                        value={allowedIps}
                        onChange={(event) => setAllowedIps(event.target.value)}
                        placeholder="203.0.113.10/32, 203.0.113.11/32"
                      />
                    </div>
                    <Button type="submit">
                      <Save className="mr-2 h-4 w-4" />
                      설정 저장
                    </Button>
                  </form>

                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">웹훅 서명 비밀키</p>
                        <p className="text-xs text-muted-foreground">
                          HMAC-SHA256 서명 검증에 사용합니다. 현재 버전{" "}
                          {webhookDeliveries?.secretVersion ?? "-"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void rotateWebhookSecret()}
                      >
                        <KeyRound className="mr-2 h-4 w-4" />
                        비밀키 교체
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void sendWebhookTest()}
                      disabled={!overview.merchant.webhookUrl}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      테스트 Webhook 전송
                    </Button>
                    {webhookSecret && (
                      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          이 값은 지금 한 번만 표시됩니다. 수신 서버의 안전한
                          비밀 저장소에 보관하세요.
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 break-all text-xs">
                            {webhookSecret}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void copy("webhook-secret", webhookSecret)
                            }
                          >
                            <Copy className="h-4 w-4" />
                            <span className="sr-only">비밀키 복사</span>
                          </Button>
                        </div>
                        {copied === "webhook-secret" && (
                          <p className="text-xs text-emerald-600">
                            복사했습니다.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <MfaEnrollmentCard />
            </TabsContent>

            <TabsContent value="finance" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardDescription>회원 수</CardDescription>
                    <CardTitle>
                      {overview.summary.memberCount.toLocaleString("ko-KR")}명
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>오늘 입금 합계</CardDescription>
                    <CardTitle>
                      {formatMoney(overview.summary.todayDepositAmount)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>활성 가상계좌</CardDescription>
                    <CardTitle>
                      {overview.summary.activeVirtualAccounts.toLocaleString(
                        "ko-KR",
                      )}
                      건
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>오늘 Webhook 이벤트</CardDescription>
                    <CardTitle>
                      {overview.summary.recentWebhookEvents.toLocaleString(
                        "ko-KR",
                      )}
                      건
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wallet className="h-4 w-4" />
                      가상계좌 / 1원인증
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span>가상계좌 기능</span>
                      <Badge
                        variant={
                          overview.integration.virtualAccountEnabled
                            ? "default"
                            : "secondary"
                        }
                      >
                        {overview.integration.virtualAccountEnabled
                          ? "활성"
                          : "비활성"}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>1원인증 기능</span>
                      <Badge
                        variant={
                          overview.integration.oneWonVerificationEnabled
                            ? "default"
                            : "secondary"
                        }
                      >
                        {overview.integration.oneWonVerificationEnabled
                          ? "활성"
                          : "비활성"}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>인증 대기</span>
                      <span>
                        {overview.summary.awaitingVerificationCount.toLocaleString(
                          "ko-KR",
                        )}
                        건
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>발급 완료</span>
                      <span>
                        {overview.summary.issuedVirtualAccountCount.toLocaleString(
                          "ko-KR",
                        )}
                        건
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" />
                      수수료 / 출금 / 정산
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span>입금 수수료</span>
                      <span>{formatMoney(overview.fees.depositFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>출금 수수료</span>
                      <span>{formatMoney(overview.fees.withdrawalFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>이용 수수료율</span>
                      <span>
                        {overview.fees.usageFeeRate == null
                          ? "미설정"
                          : `${overview.fees.usageFeeRate}%`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>일일 출금 한도</span>
                      <span>
                        {formatMoney(overview.merchant.dailyWithdrawalLimit)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>출금 기능</span>
                      <Badge
                        variant={
                          overview.integration.payoutEnabled
                            ? "default"
                            : "secondary"
                        }
                      >
                        {overview.integration.payoutEnabled ? "활성" : "비활성"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="activity" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>가맹점 Webhook 전송 이력</CardTitle>
                  <CardDescription>
                    TodoPay가 등록된 URL로 보낸 입금·출금 이벤트의 전달
                    결과입니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {webhookDeliveries?.items.length ? (
                    webhookDeliveries.items.map((item) => (
                      <div
                        key={item.eventId}
                        className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{item.eventType}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.eventId}
                          </p>
                          {item.lastError && (
                            <p className="mt-1 text-xs text-destructive">
                              {item.lastError}
                            </p>
                          )}
                        </div>
                        <div className="text-left md:text-right">
                          <Badge
                            variant={
                              item.status === "delivered"
                                ? "default"
                                : item.status === "dead"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {item.status}
                          </Badge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            시도 {item.attemptCount}회
                            {item.responseStatus
                              ? ` · HTTP ${item.responseStatus}`
                              : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isoLabel(
                              item.deliveredAt ??
                                item.lastAttemptAt ??
                                item.createdAt,
                            )}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground">
                      아직 전송된 Webhook 이벤트가 없습니다.
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>최근 Webhook 이벤트</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {activity?.webhookEvents.length ? (
                      activity.webhookEvents.map((item) => (
                        <div
                          key={`${item.eventType}-${item.trackingNumber}-${item.processedAt}`}
                          className="rounded-md border p-3"
                        >
                          <p className="font-medium">{item.eventType}</p>
                          <p className="text-muted-foreground">
                            {item.trackingNumber}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isoLabel(item.processedAt)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">
                        수신 이력이 없습니다.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>최근 거래</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {activity?.recentTransactions.length ? (
                      activity.recentTransactions.map((item) => (
                        <div
                          key={`${item.trackingNumber}-${item.updatedAt}`}
                          className="rounded-md border p-3"
                        >
                          <p className="font-medium">{item.trackingNumber}</p>
                          <p className="text-muted-foreground">
                            {item.status} · {formatMoney(item.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isoLabel(item.updatedAt)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">
                        거래 이력이 없습니다.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>최근 출금</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {activity?.recentWithdrawals.length ? (
                      activity.recentWithdrawals.map((item) => (
                        <div
                          key={`${item.trackingNumber}-${item.updatedAt}`}
                          className="rounded-md border p-3"
                        >
                          <p className="font-medium">{item.trackingNumber}</p>
                          <p className="text-muted-foreground">
                            {item.status} · {formatMoney(item.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isoLabel(item.updatedAt)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">
                        출금 이력이 없습니다.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="test" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>테스트 센터</CardTitle>
                  <CardDescription>
                    허용 IP가 등록된 서버 환경에서 테스트할 때 가장 정확합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="test-api-key">테스트용 API 키</Label>
                    <Input
                      id="test-api-key"
                      type="password"
                      value={testApiKey}
                      onChange={(event) => setTestApiKey(event.target.value)}
                      placeholder="tp_live_..."
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={testing}
                      onClick={() => void testConnection()}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      GET /merchant 연결 테스트
                    </Button>
                  </div>

                  <div className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <div>
                      <Label htmlFor="test-member-id">테스트 회원 ID</Label>
                      <Input
                        id="test-member-id"
                        value={testMemberLoginId}
                        onChange={(event) =>
                          setTestMemberLoginId(event.target.value)
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="test-member-name">테스트 회원명</Label>
                      <Input
                        id="test-member-name"
                        value={testMemberName}
                        onChange={(event) =>
                          setTestMemberName(event.target.value)
                        }
                      />
                    </div>
                    <Button
                      variant="outline"
                      disabled={testing}
                      onClick={() => void testMemberCreate()}
                    >
                      테스트 회원 생성
                    </Button>
                  </div>

                  {testResult && (
                    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs">{`HTTP ${testResult.status}\n${testResult.body}`}</pre>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Merchant API 문서</CardTitle>
                  <CardDescription>
                    가맹점 서버가 TodoPay와 연동할 때 필요한 핵심 정보를
                    정리했습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 text-sm">
                  <div className="rounded-md border p-4">
                    <p className="font-medium">인증 방식</p>
                    <p className="mt-1 text-muted-foreground">
                      모든 요청은 <code>X-TodoPay-Api-Key</code> 헤더를
                      포함합니다. 허용 IP가 등록되지 않으면 외부 API는
                      차단됩니다.
                    </p>
                  </div>

                  <div className="rounded-md border p-4">
                    <p className="font-medium">기본 주소</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="break-all">{API_BASE_URL}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void copy("base-url", API_BASE_URL)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {copied === "base-url" && (
                        <span className="text-xs text-muted-foreground">
                          복사됨
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[680px] text-left">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-3">Method</th>
                          <th className="p-3">Path</th>
                          <th className="p-3">설명</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t">
                          <td className="p-3 font-mono">GET</td>
                          <td className="p-3 font-mono">/merchant</td>
                          <td className="p-3">
                            인증된 가맹점 정보와 현재 연동 설정 조회
                          </td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 font-mono">GET</td>
                          <td className="p-3 font-mono">/overview</td>
                          <td className="p-3">회원/거래/출금/입금 요약 조회</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 font-mono">GET</td>
                          <td className="p-3 font-mono">/members</td>
                          <td className="p-3">회원 목록 조회</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 font-mono">POST</td>
                          <td className="p-3 font-mono">/members</td>
                          <td className="p-3">회원 생성</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 font-mono">GET</td>
                          <td className="p-3 font-mono">
                            /transactions /withdrawals /webhook-events
                          </td>
                          <td className="p-3">거래, 출금, 이벤트 로그 조회</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="mb-2 font-medium">연결 예시</p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">
                      {curlExample}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </PartnerLayout>
  );
}

export default function PartnerPortalV5() {
  return (
    <AuthProvider>
      <PartnerPortal />
    </AuthProvider>
  );
}
