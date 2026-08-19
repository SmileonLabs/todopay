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

export function PartnerFinanceSection() {
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
  if (!overview) return null;
  return (
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
              {overview.summary.activeVirtualAccounts.toLocaleString("ko-KR")}건
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>오늘 Webhook 이벤트</CardDescription>
            <CardTitle>
              {overview.summary.recentWebhookEvents.toLocaleString("ko-KR")}건
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
                {overview.integration.virtualAccountEnabled ? "활성" : "비활성"}
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
              <span>{formatMoney(overview.merchant.dailyWithdrawalLimit)}</span>
            </div>
            <div className="flex justify-between">
              <span>출금 기능</span>
              <Badge
                variant={
                  overview.integration.payoutEnabled ? "default" : "secondary"
                }
              >
                {overview.integration.payoutEnabled ? "활성" : "비활성"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
