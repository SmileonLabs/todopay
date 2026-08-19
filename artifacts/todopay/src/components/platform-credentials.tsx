import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Activity,
  BellRing,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Users,
  WalletCards,
  Webhook,
  X,
} from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import Login from "@/pages/login";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Badge } from "@/components/ui/badge";
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
import { MfaEnrollmentCard } from "@/components/mfa-enrollment-card";
import type {
  AuditLog,
  FilterState,
  Merchant,
  MerchantDetail,
  Overview,
  Pagination,
  Payment,
  PaymentDetail,
  RequestFn,
  RunFn,
  Section,
  SystemStatus,
  WebhookEvent,
  Withdrawal,
} from "../platform-console-types";

import {
  DataTable,
  Empty,
  Field,
  Pager,
  StateBadge,
  dateTime,
  safeOperatorName,
  statusLabel,
  won,
} from "./platform-console-ui";
export function Credentials(props: {
  merchants: Merchant[];
  selected: Merchant | null;
  selectedId: number | null;
  select: (id: number) => void;
  detail: MerchantDetail | null;
  oneTimeKey: string | null;
  dismiss: () => void;
  run: RunFn;
  request: RequestFn;
  reload: () => Promise<void>;
  setKey: (value: string | null) => void;
  notify: (value: string) => void;
}) {
  const [operator, setOperator] = useState({
    loginId: "",
    name: "",
    password: "",
  });
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">계정·API 자격증명</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          가맹점 운영자와 API 키의 발급·정지 이력을 분리 관리합니다.
        </p>
      </div>
      <select
        className="h-10 min-w-72 rounded-md border bg-background px-3 text-sm"
        value={props.selectedId ?? ""}
        onChange={(e) => props.select(Number(e.target.value))}
      >
        <option value="">가맹점 선택</option>
        {props.merchants.map((merchant) => (
          <option key={merchant.id} value={merchant.id}>
            {merchant.name} ({merchant.code})
          </option>
        ))}
      </select>
      {props.oneTimeKey && (
        <Card className="border-amber-500">
          <CardHeader>
            <CardTitle>새 API 키 — 1회 표시</CardTitle>
            <CardDescription>
              지금 안전한 비밀 저장소에 보관하세요. 화면을 닫으면 다시 확인할 수
              없습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-lg bg-muted p-4 text-sm">
              {props.oneTimeKey}
            </code>
            <Button className="mt-3" variant="outline" onClick={props.dismiss}>
              확인 후 닫기
            </Button>
          </CardContent>
        </Card>
      )}
      {props.selected && props.detail ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>API 키</CardTitle>
              <CardDescription>
                현재 접두사: {props.selected.apiKeyPrefix ?? "발급되지 않음"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <StateBadge
                  value={
                    props.detail.integration.apiKeyIssued ? "active" : "pending"
                  }
                />
                <span className="text-sm">
                  허용 IP {props.detail.integration.allowedIpCount}개 · Webhook{" "}
                  {props.detail.integration.webhookConfigured
                    ? "설정됨"
                    : "미설정"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (
                      !confirm(
                        "기존 키는 즉시 사용할 수 없게 됩니다. 새 키를 발급할까요?",
                      )
                    )
                      return;
                    void props.run(async () => {
                      const result = await props.request<{ apiKey: string }>(
                        `/platform/merchants/${props.selected!.id}/api-key`,
                        { method: "POST" },
                      );
                      props.setKey(result.apiKey);
                      await props.reload();
                    });
                  }}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  발급·교체
                </Button>
                <Button
                  variant="destructive"
                  disabled={!props.detail.integration.apiKeyIssued}
                  onClick={() => {
                    if (
                      !confirm(
                        "API 키를 폐기하면 가맹점 API 호출이 즉시 중단됩니다. 계속할까요?",
                      )
                    )
                      return;
                    void props.run(async () => {
                      await props.request(
                        `/platform/merchants/${props.selected!.id}/api-key`,
                        { method: "DELETE" },
                      );
                      await props.reload();
                      props.notify("API 키를 폐기했습니다.");
                    });
                  }}
                >
                  키 폐기
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>파트너 운영자 추가·변경</CardTitle>
              <CardDescription>
                비밀번호는 12자 이상으로 설정하며 원문은 저장하지 않습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void props.run(async () => {
                    await props.request(
                      `/platform/merchants/${props.selected!.id}/partner-operator`,
                      { method: "PUT", body: JSON.stringify(operator) },
                    );
                    setOperator({ loginId: "", name: "", password: "" });
                    await props.reload();
                    props.notify("파트너 운영자를 등록했습니다.");
                  });
                }}
              >
                <Field label="로그인 ID">
                  <Input
                    value={operator.loginId}
                    onChange={(e) =>
                      setOperator({ ...operator, loginId: e.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="담당자명">
                  <Input
                    value={operator.name}
                    onChange={(e) =>
                      setOperator({ ...operator, name: e.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="초기 비밀번호">
                  <Input
                    type="password"
                    minLength={12}
                    value={operator.password}
                    onChange={(e) =>
                      setOperator({ ...operator, password: e.target.value })
                    }
                    required
                  />
                </Field>
                <Button className="w-full">
                  <Users className="mr-2 h-4 w-4" />
                  운영자 등록
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>등록 운영자</CardTitle>
            </CardHeader>
            <CardContent>
              {props.detail.operators.length ? (
                <DataTable
                  headers={[
                    "등록일",
                    "이름",
                    "로그인 ID",
                    "상태",
                    "OTP",
                    "관리",
                  ]}
                >
                  {props.detail.operators.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">{dateTime(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        {safeOperatorName(item.name)}
                      </td>
                      <td className="px-4 py-3">{item.loginId}</td>
                      <td className="px-4 py-3">
                        <StateBadge
                          value={item.isActive ? "active" : "suspended"}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {item.useOtp ? "사용" : "미사용"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void props.run(async () => {
                                await props.request(
                                  `/platform/partner-operators/${item.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      isActive: !item.isActive,
                                    }),
                                  },
                                );
                                await props.reload();
                              })
                            }
                          >
                            {item.isActive ? "정지" : "활성"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void props.run(async () => {
                                await props.request(
                                  `/platform/partner-operators/${item.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      useOtp: !item.useOtp,
                                    }),
                                  },
                                );
                                await props.reload();
                              })
                            }
                          >
                            OTP {item.useOtp ? "해제" : "적용"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const password = prompt(
                                "12자 이상의 새 비밀번호를 입력하세요.",
                              );
                              if (!password) return;
                              void props.run(async () => {
                                await props.request(
                                  `/platform/partner-operators/${item.id}/reset-password`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({ password }),
                                  },
                                );
                                props.notify(
                                  "운영자 비밀번호를 재설정했습니다.",
                                );
                              });
                            }}
                          >
                            비밀번호 재설정
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Empty>가맹점을 선택하세요.</Empty>
      )}
    </>
  );
}
