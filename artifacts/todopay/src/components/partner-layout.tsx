import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  CreditCard,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandWordmark } from "@/components/brand-wordmark";

export type PartnerSection =
  | "dashboard"
  | "payments"
  | "settings"
  | "finance"
  | "activity"
  | "test"
  | "docs";

const NAV_ITEMS: Array<{
  id: PartnerSection;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = [
  {
    id: "dashboard",
    label: "대시보드",
    description: "운영 및 연동 현황",
    icon: LayoutDashboard,
  },
  {
    id: "payments",
    label: "결제 내역",
    description: "고객 결제 목록 및 상세",
    icon: CreditCard,
  },
  {
    id: "settings",
    label: "연동 설정",
    description: "API 키, Webhook, 허용 IP",
    icon: Settings2,
  },
  {
    id: "finance",
    label: "가상계좌·정산",
    description: "가상계좌, 수수료, 출금",
    icon: Landmark,
  },
  {
    id: "activity",
    label: "이벤트·활동 로그",
    description: "Webhook, 거래, 출금 이력",
    icon: Activity,
  },
  {
    id: "test",
    label: "테스트 센터",
    description: "API 연결 및 데이터 테스트",
    icon: FlaskConical,
  },
  {
    id: "docs",
    label: "API 문서",
    description: "연동 규격 및 호출 예시",
    icon: BookOpen,
  },
];

export const PARTNER_SECTION_LABELS: Record<PartnerSection, string> =
  Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.label])) as Record<
    PartnerSection,
    string
  >;

type PartnerLayoutProps = {
  activeSection: PartnerSection;
  children: React.ReactNode;
  integrationLabel?: string;
  merchantCode?: string;
  merchantName?: string;
  onRefresh: () => void;
  onSectionChange: (section: PartnerSection) => void;
  onSignOut: () => void;
  refreshing: boolean;
  userName: string;
};

export function PartnerLayout({
  activeSection,
  children,
  integrationLabel,
  merchantCode,
  merchantName,
  onRefresh,
  onSectionChange,
  onSignOut,
  refreshing,
  userName,
}: PartnerLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncSidebar = () => setSidebarOpen(media.matches);

    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  const selectSection = (section: PartnerSection) => {
    onSectionChange(section);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out lg:relative lg:z-auto lg:w-64",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:hidden",
        ].join(" ")}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <div>
              <BrandWordmark className="h-auto w-36" />
              <p className="text-[11px] text-muted-foreground">
                가맹점 API 운영 포털
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="메뉴 닫기"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Partner menu
          </p>
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeSection;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-cyan-500/12 text-cyan-300"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                  onClick={() => selectSection(item.id)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="block truncate text-[11px] opacity-70">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-border bg-muted/20 p-4">
          <div className="mb-3 min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold">
                {merchantName ?? "가맹점"}
              </p>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                가맹점
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {merchantCode ?? "정보 확인 중"}
            </p>
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {userName}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={onSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            로그아웃
          </Button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 shadow-sm md:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="메뉴 열기"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {PARTNER_SECTION_LABELS[activeSection]}
            </p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {merchantName ?? "가맹점 정보를 불러오는 중입니다."}
            </p>
          </div>
          <div className="flex-1" />
          {integrationLabel && (
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              {integrationLabel}
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw
              className={`h-4 w-4 sm:mr-2 ${refreshing ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl space-y-6">{children}</div>
        </main>
      </section>
    </div>
  );
}
