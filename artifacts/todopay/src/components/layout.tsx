import React, { useEffect, useState } from "react";
import logo from "@/assets/logo.svg";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowRightLeft,
  Wallet,
  Users,
  ShieldCheck,
  Receipt,
  BarChart3,
  Bell,
  KeyRound,
  LogOut,
  Menu,
  UserCog,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  superadmin: "border-purple-500/50 text-purple-400",
  hq: "border-blue-500/50 text-blue-400",
  distributor: "border-green-500/50 text-green-400",
  agency: "border-orange-500/50 text-orange-400",
  store: "border-yellow-500/50 text-yellow-400",
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: "슈퍼관리자",
  hq: "본사",
  distributor: "총판",
  agency: "대리점",
  store: "매장",
};

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, signOut, isLoading } = useAuth();
  const logout = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(window.innerWidth >= 768);
  }, []);

  useEffect(() => {
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [location]);

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        signOut();
        setLocation("/login");
      },
    });
  };

  const navItems = [
    { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
    { href: "/withdrawals", label: "출금 관리", icon: ArrowDownToLine },
    { href: "/transactions", label: "입출금 내역", icon: ArrowRightLeft },
    { href: "/balances", label: "충전금액 관리", icon: Wallet },
    { href: "/members", label: "회원 관리", icon: Users },
    { href: "/users", label: "하부 조직 관리", icon: ShieldCheck },
    { href: "/fees", label: "수수료 설정", icon: Receipt },
    { href: "/statistics", label: "일자별 통계", icon: BarChart3 },
    { href: "/notices", label: "공지사항", icon: Bell },
    { href: "/otp", label: "OTP 설정", icon: KeyRound },
    { href: "/profile", label: "내 계정", icon: UserCog },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          "fixed md:relative inset-y-0 left-0 z-50 md:z-auto",
          "flex flex-col bg-sidebar border-r border-sidebar-border flex-shrink-0",
          "w-72 md:w-64",
          "transition-transform md:transition-all duration-300 ease-in-out",
          sidebarOpen
            ? "translate-x-0 md:w-64"
            : "-translate-x-full md:-translate-x-0 md:w-0 md:overflow-hidden",
        ].join(" ")}
      >
        <div className="h-16 flex items-center px-5 border-b border-sidebar-border shrink-0 justify-between">
          <img src={logo} alt="TodoPay" className="h-14 w-auto brightness-0 invert" />
          <button
            className="md:hidden text-muted-foreground hover:text-foreground p-1"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                location === item.href
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border shrink-0 bg-sidebar/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">{user.name}</span>
              <span className="text-xs text-muted-foreground truncate">{user.loginId}</span>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] uppercase shrink-0 ml-2 ${ROLE_COLORS[user.role] ?? ""}`}
            >
              {ROLE_LABELS[user.role] ?? user.role}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            로그아웃
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        <header className="h-14 md:h-16 border-b border-border bg-card flex items-center px-4 md:px-6 shrink-0 z-10 shadow-sm gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-muted-foreground shrink-0"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src={logo} alt="TodoPay" className="h-8 w-auto md:hidden brightness-0 invert" />
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground hidden sm:block">
            {ROLE_LABELS[user.role] ?? user.role} · {user.name}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
