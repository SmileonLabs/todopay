import { Copy, KeyRound, Link2, Play, Save } from "lucide-react";
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
import { TabsContent } from "@/components/ui/tabs";
import { MfaEnrollmentCard } from "@/components/mfa-enrollment-card";
import { usePartnerPortalContext } from "@/contexts/partner-portal-context";
import { API_BASE_URL } from "../partner-portal-ui";

export function PartnerSettingsSection() {
  const {
    overview,
    webhookUrl,
    setWebhookUrl,
    allowedIps,
    setAllowedIps,
    webhookSecret,
    webhookDeliveries,
    copied,
    saveSettings,
    rotateKey,
    rotateWebhookSecret,
    sendWebhookTest,
    copy,
  } = usePartnerPortalContext();
  if (!overview) return null;
  return (
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
              <span className="text-muted-foreground">현재 Webhook URL:</span>{" "}
              {overview.merchant.webhookUrl ?? "미설정"}
            </div>
            <div>
              <span className="text-muted-foreground">현재 허용 IP:</span>{" "}
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
                  이 값은 지금 한 번만 표시됩니다. 수신 서버의 안전한 비밀
                  저장소에 보관하세요.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-xs">
                    {webhookSecret}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copy("webhook-secret", webhookSecret)}
                  >
                    <Copy className="h-4 w-4" />
                    <span className="sr-only">비밀키 복사</span>
                  </Button>
                </div>
                {copied === "webhook-secret" && (
                  <p className="text-xs text-emerald-600">복사했습니다.</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <MfaEnrollmentCard />
    </TabsContent>
  );
}
