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
import { usePartnerPortalState } from "@/hooks/use-partner-portal";
import type {
  ApiTestResult,
  PartnerActivity as Activity,
  PartnerOverview as Overview,
  WebhookDeliveries,
} from "../partner-portal-types";

import { usePartnerPortalContext } from "@/contexts/partner-portal-context";
import {
  API_BASE_URL,
  formatMoney,
  isoLabel,
  stageLabel,
  statusVariant,
} from "../partner-portal-ui";

export function PartnerDocsSection() {
  const {
    user,
    token,
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
  } = usePartnerPortalContext();
  return (
    <TabsContent value="docs" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Merchant API 문서</CardTitle>
          <CardDescription>
            가맹점 서버가 TodoPay와 연동할 때 필요한 핵심 정보를 정리했습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div className="rounded-md border p-4">
            <p className="font-medium">인증 방식</p>
            <p className="mt-1 text-muted-foreground">
              모든 요청은 <code>X-TodoPay-Api-Key</code> 헤더를 포함합니다. 허용
              IP가 등록되지 않으면 외부 API는 차단됩니다.
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
                <span className="text-xs text-muted-foreground">복사됨</span>
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
  );
}
