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
  formatMoney,
  isoLabel,
  stageLabel,
  statusVariant,
} from "../partner-portal-ui";

export function PartnerTestSection() {
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
            <Button disabled={testing} onClick={() => void testConnection()}>
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
                onChange={(event) => setTestMemberLoginId(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="test-member-name">테스트 회원명</Label>
              <Input
                id="test-member-name"
                value={testMemberName}
                onChange={(event) => setTestMemberName(event.target.value)}
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
  );
}
