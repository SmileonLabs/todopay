import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowRightLeft,
  Wallet,
  Users,
  UserCircle,
  ShieldCheck,
  Receipt,
  BarChart3,
  Bell,
  KeyRound,
  LogOut,
  Menu,
  UserCog,
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    { href: "/buyers", label: "구매자 관리", icon: UserCircle },
    { href: "/members", label: "회원 관리", icon: Users },
    { href: "/users", label: "유저 관리", icon: ShieldCheck },
    { href: "/fees", label: "수수료 설정", icon: Receipt },
    { href: "/statistics", label: "일자별 통계", icon: BarChart3 },
    { href: "/notices", label: "공지사항", icon: Bell },
    { href: "/otp", label: "OTP 설정", icon: KeyRound },
    { href: "/profile", label: "내 계정", icon: UserCog },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      {/* Sidebar */}
      <aside
        className={`bg-sidebar border-r border-sidebar-border flex-shrink-0 flex flex-col transition-all duration-300 ${sidebarOpen ? "w-64" : "w-0 overflow-hidden"}`}
      >
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border shrink-0">
          <span className="text-xl font-bold text-primary tracking-tight">TodoPay</span>
          <span className="ml-2 text-xs text-muted-foreground">ADMIN</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
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
        <header className="h-16 border-b border-border bg-card flex items-center px-6 shrink-0 z-10 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="mr-4 text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground hidden sm:block">
            {ROLE_LABELS[user.role] ?? user.role} · {user.name}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
