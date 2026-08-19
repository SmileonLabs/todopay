import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Loader2,
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
import { usePartnerPortalState } from "@/hooks/use-partner-portal";
import { PartnerPortalProvider } from "@/contexts/partner-portal-context";
import { stageLabel, statusVariant } from "./partner-portal-ui";
import { PartnerPaymentsSection } from "@/components/partner-payments-section";
import { PartnerSettingsSection } from "@/components/partner-settings-section";
import { PartnerFinanceSection } from "@/components/partner-finance-section";
import { PartnerActivitySection } from "@/components/partner-activity-section";
import { PartnerTestSection } from "@/components/partner-test-section";
import { PartnerDocsSection } from "@/components/partner-docs-section";
import type {
  ApiTestResult,
  PartnerActivity as Activity,
  PartnerOverview as Overview,
  WebhookDeliveries,
} from "./partner-portal-types";

const API_BASE_URL = "https://api.todopay.io/api/external/v1";

function PartnerPortal() {
  const portalState = usePartnerPortalState();
  const {
    user,
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
  } = portalState;
  const currentUser = user as
    | (typeof user & { merchantId?: number | null })
    | null;

  if (isLoading) return <div className="min-h-screen bg-background" />;
  if (!currentUser) return <Login />;

  const displayUserName =
    currentUser.name && !currentUser.name.includes("?")
      ? currentUser.name
      : currentUser.loginId;
  const initialDataLoading = loading && !overview;

  return (
    <PartnerPortalProvider value={portalState}>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p>{error}</p>
            {!overview && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void load()}
              >
                다시 시도
              </Button>
            )}
          </div>
        )}

        {initialDataLoading && (
          <Card>
            <CardContent className="flex min-h-48 items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              대시보드 정보를 불러오는 중입니다.
            </CardContent>
          </Card>
        )}

        {apiKey && activeSection === "settings" && (
          <Card className="border-amber-500">
            <CardHeader>
              <CardTitle>새 API 키</CardTitle>
              <CardDescription>
                이 키는 지금 한 번만 표시됩니다. 안전한 비밀 저장소에 즉시
                보관해 주세요.
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
                      variant={statusVariant(
                        overview.merchant.integrationStage,
                      )}
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
                        {overview.integration.externalApiReady
                          ? "허용"
                          : "차단"}
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
                            {item.done
                              ? "완료"
                              : item.required
                                ? "필수"
                                : "선택"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}

            <Tabs value={activeSection} className="space-y-6">
              <PartnerPaymentsSection />

              <PartnerSettingsSection />

              <PartnerFinanceSection />

              <PartnerActivitySection />

              <PartnerTestSection />

              <PartnerDocsSection />
            </Tabs>
          </>
        )}
      </PartnerLayout>
    </PartnerPortalProvider>
  );
}

export default function PartnerPortalV5() {
  return (
    <AuthProvider>
      <PartnerPortal />
    </AuthProvider>
  );
}
