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

export function PartnerActivitySection() {
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
    <TabsContent value="activity" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>가맹점 Webhook 전송 이력</CardTitle>
          <CardDescription>
            TodoPay가 등록된 URL로 보낸 입금·출금 이벤트의 전달 결과입니다.
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
                      item.deliveredAt ?? item.lastAttemptAt ?? item.createdAt,
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
                  <p className="text-muted-foreground">{item.trackingNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {isoLabel(item.processedAt)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">수신 이력이 없습니다.</p>
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
              <p className="text-muted-foreground">거래 이력이 없습니다.</p>
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
              <p className="text-muted-foreground">출금 이력이 없습니다.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
