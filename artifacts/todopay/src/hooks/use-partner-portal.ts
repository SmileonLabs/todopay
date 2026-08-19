import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import type { PartnerSection } from "@/components/partner-layout";
import type {
  ApiTestResult,
  PartnerActivity as Activity,
  PartnerOverview as Overview,
  WebhookDeliveries,
} from "../partner-portal-types";

const API_BASE_URL = "https://api.todopay.io/api/external/v1";

export function usePartnerPortalState() {
  const { user, isAuthenticated, signOut, isLoading } = useAuth();
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
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
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
    [],
  );

  const load = useCallback(async () => {
    if (!isAuthenticated || !user) return;

    setLoading(true);
    try {
      const [overviewResult, activityResult, deliveryResult] =
        await Promise.allSettled([
          request<Overview>("/partner/overview"),
          request<Activity>("/partner/activity"),
          request<WebhookDeliveries>("/partner/webhook-deliveries"),
        ]);
      if (overviewResult.status === "rejected") throw overviewResult.reason;

      const nextOverview = overviewResult.value;
      setOverview(nextOverview);
      setWebhookUrl(nextOverview.merchant.webhookUrl ?? "");
      setAllowedIps(nextOverview.merchant.allowedIps.join(", "));
      setActivity(
        activityResult.status === "fulfilled" ? activityResult.value : null,
      );
      setWebhookDeliveries(
        deliveryResult.status === "fulfilled" ? deliveryResult.value : null,
      );
      const secondaryFailures = [activityResult, deliveryResult].filter(
        (result) => result.status === "rejected",
      ).length;
      setError(
        secondaryFailures > 0
          ? `일부 보조 정보를 불러오지 못했습니다. (${secondaryFailures}개)`
          : null,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "가맹점 정보를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, request, user]);

  useEffect(() => {
    if (!isAuthenticated) {
      setOverview(null);
      setActivity(null);
      setWebhookDeliveries(null);
      setError(null);
      return;
    }
    void load();
  }, [isAuthenticated, load]);

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

  return {
    user,
    isAuthenticated,
    signOut,
    isLoading,
    request,
    overview,
    activity,
    webhookUrl,
    setWebhookUrl,
    allowedIps,
    setAllowedIps,
    apiKey,
    webhookSecret,
    webhookDeliveries,
    error,
    loading,
    copied,
    testApiKey,
    setTestApiKey,
    testResult,
    testing,
    testMemberLoginId,
    setTestMemberLoginId,
    testMemberName,
    setTestMemberName,
    activeSection,
    setActiveSection,
    load,
    saveSettings,
    rotateKey,
    rotateWebhookSecret,
    sendWebhookTest,
    copy,
    testConnection,
    testMemberCreate,
    curlExample,
  };
}
