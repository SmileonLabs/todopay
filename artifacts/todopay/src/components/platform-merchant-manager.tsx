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
export function MerchantManager(props: {
  merchants: Merchant[];
  pagination?: Pagination;
  search: string;
  setSearch: (value: string) => void;
  selectedId: number | null;
  select: (id: number) => void;
  detail: MerchantDetail | null;
  request: RequestFn;
  run: RunFn;
  reload: () => Promise<void>;
  onPage: (page: number) => void;
  notify: (value: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const emptyCreate = {
    code: "",
    name: "",
    operatorName: "",
    loginId: "",
    password: "",
    passwordConfirm: "",
  };
  const [create, setCreate] = useState(emptyCreate);
  const [edit, setEdit] = useState({
    name: "",
    status: "pending",
    webhookUrl: "",
    allowedIps: "",
    dailyWithdrawalLimit: "0",
    depositFee: "0",
    withdrawalFee: "0",
    usageFeeRate: "0",
  });
  useEffect(() => {
    if (!props.detail) return;
    const { merchant, fees } = props.detail;
    setEdit({
      name: merchant.name,
      status: merchant.status,
      webhookUrl: merchant.webhookUrl ?? "",
      allowedIps: merchant.allowedIps.join(", "),
      dailyWithdrawalLimit: String(merchant.dailyWithdrawalLimit),
      depositFee: String(fees?.depositFee ?? 0),
      withdrawalFee: String(fees?.withdrawalFee ?? 0),
      usageFeeRate: String(fees?.usageFeeRate ?? 0),
    });
  }, [props.detail]);
  const save = () =>
    props.run(async () => {
      if (!props.selectedId) return;
      await props.request(`/platform/merchants/${props.selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: edit.name,
          status: edit.status,
          webhookUrl: edit.webhookUrl,
          allowedIps: edit.allowedIps
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          dailyWithdrawalLimit: Number(edit.dailyWithdrawalLimit),
        }),
      });
      await props.request(`/platform/merchants/${props.selectedId}/fees`, {
        method: "PUT",
        body: JSON.stringify({
          depositFee: Number(edit.depositFee),
          withdrawalFee: Number(edit.withdrawalFee),
          usageFeeRate: Number(edit.usageFeeRate),
        }),
      });
      await props.reload();
      props.notify("가맹점 운영 설정과 수수료 정책을 저장했습니다.");
    });
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">가맹점 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            TodoPay 계약, 연동, 수수료 정책을 가맹점 단위로 관리합니다.
          </p>
        </div>
        <Button onClick={() => setCreateOpen((value) => !value)}>
          <Plus className="mr-2 h-4 w-4" />
          가맹점 등록
        </Button>
      </div>
      {createOpen && (
        <Card>
          <CardHeader>
            <CardTitle>새 가맹점 등록</CardTitle>
            <CardDescription>
              가맹점과 최초 파트너 관리자 계정을 함께 생성합니다. 등록 후 운영
              설정을 완료하고 가맹점을 활성화하세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (create.password !== create.passwordConfirm) {
                  props.notify(
                    "초기 비밀번호와 비밀번호 확인이 일치하지 않습니다.",
                  );
                  return;
                }
                void props.run(async () => {
                  await props.request("/platform/merchants", {
                    method: "POST",
                    body: JSON.stringify({
                      code: create.code,
                      name: create.name,
                      partnerOperator: {
                        name: create.operatorName,
                        loginId: create.loginId,
                        password: create.password,
                      },
                    }),
                  });
                  setCreate(emptyCreate);
                  setCreateOpen(false);
                  await props.reload();
                  props.notify(
                    "가맹점과 파트너 관리자 계정을 등록했습니다. 운영 설정 후 가맹점을 활성화하세요.",
                  );
                });
              }}
            >
              <Field label="가맹점 코드">
                <Input
                  value={create.code}
                  onChange={(e) =>
                    setCreate({ ...create, code: e.target.value.toUpperCase() })
                  }
                  placeholder="MERCHANT_001"
                  required
                />
              </Field>
              <Field label="가맹점명">
                <Input
                  value={create.name}
                  onChange={(e) =>
                    setCreate({ ...create, name: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="관리자 담당자명">
                <Input
                  value={create.operatorName}
                  onChange={(e) =>
                    setCreate({ ...create, operatorName: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="로그인 ID">
                <Input
                  value={create.loginId}
                  onChange={(e) =>
                    setCreate({ ...create, loginId: e.target.value })
                  }
                  minLength={3}
                  maxLength={50}
                  pattern="[A-Za-z0-9_.-]+"
                  title="영문, 숫자, 밑줄, 마침표, 하이픈만 사용할 수 있습니다."
                  autoComplete="off"
                  required
                />
              </Field>
              <Field label="초기 비밀번호">
                <Input
                  type="password"
                  value={create.password}
                  onChange={(e) =>
                    setCreate({ ...create, password: e.target.value })
                  }
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field label="초기 비밀번호 확인">
                <Input
                  type="password"
                  value={create.passwordConfirm}
                  onChange={(e) =>
                    setCreate({ ...create, passwordConfirm: e.target.value })
                  }
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <div className="flex items-end md:col-span-2 xl:col-span-3">
                <Button className="w-full">가맹점 및 관리자 등록</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>가맹점 목록</CardTitle>
            <CardDescription>검색 후 항목을 선택하세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={props.search}
                onChange={(e) => props.setSearch(e.target.value)}
                placeholder="코드 또는 가맹점명"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void props.run(() => props.reload());
                }}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => void props.run(() => props.reload())}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
            {props.merchants.length ? (
              props.merchants.map((merchant) => (
                <button
                  key={merchant.id}
                  onClick={() => props.select(merchant.id)}
                  className={`w-full rounded-lg border p-3 text-left ${props.selectedId === merchant.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{merchant.name}</p>
                    <StateBadge value={merchant.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {merchant.code}
                  </p>
                </button>
              ))
            ) : (
              <Empty />
            )}
            <Pager value={props.pagination} onChange={props.onPage} />
          </CardContent>
        </Card>
        {props.detail ? (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["회원", props.detail.summary.members],
                ["결제", props.detail.summary.payments],
                ["출금", props.detail.summary.withdrawals],
                ["활성 가상계좌", props.detail.summary.activeVirtualAccounts],
              ].map(([label, value]) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold">
                      {Number(value).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{props.detail.merchant.name} 운영 설정</CardTitle>
                <CardDescription>
                  API 요청 IP는 쉼표로 구분하며 Webhook URL은 HTTPS만
                  허용합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="가맹점명">
                  <Input
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </Field>
                <Field label="상태">
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={edit.status}
                    onChange={(e) =>
                      setEdit({ ...edit, status: e.target.value })
                    }
                  >
                    {["pending", "active", "suspended", "terminated"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {statusLabel[value]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="일 출금 한도">
                  <Input
                    type="number"
                    min="0"
                    value={edit.dailyWithdrawalLimit}
                    onChange={(e) =>
                      setEdit({ ...edit, dailyWithdrawalLimit: e.target.value })
                    }
                  />
                </Field>
                <Field label="Webhook URL">
                  <Input
                    value={edit.webhookUrl}
                    onChange={(e) =>
                      setEdit({ ...edit, webhookUrl: e.target.value })
                    }
                    placeholder="https://..."
                  />
                </Field>
                <Field label="API 허용 IP">
                  <Input
                    value={edit.allowedIps}
                    onChange={(e) =>
                      setEdit({ ...edit, allowedIps: e.target.value })
                    }
                    placeholder="203.0.113.10/32"
                  />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>TodoPay 계약 수수료</CardTitle>
                <CardDescription>
                  가맹점 내부 조직 수수료와 분리된 플랫폼 계약 기준입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <Field label="입금 건당 수수료">
                  <Input
                    type="number"
                    min="0"
                    value={edit.depositFee}
                    onChange={(e) =>
                      setEdit({ ...edit, depositFee: e.target.value })
                    }
                  />
                </Field>
                <Field label="출금 건당 수수료">
                  <Input
                    type="number"
                    min="0"
                    value={edit.withdrawalFee}
                    onChange={(e) =>
                      setEdit({ ...edit, withdrawalFee: e.target.value })
                    }
                  />
                </Field>
                <Field label="서비스 이용률 (%)">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={edit.usageFeeRate}
                    onChange={(e) =>
                      setEdit({ ...edit, usageFeeRate: e.target.value })
                    }
                  />
                </Field>
                <div className="sm:col-span-3 flex justify-end">
                  <Button onClick={save}>
                    <Save className="mr-2 h-4 w-4" />
                    전체 설정 저장
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Empty>가맹점을 선택하면 상세 설정이 표시됩니다.</Empty>
        )}
      </div>
    </>
  );
}
