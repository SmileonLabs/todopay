import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
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
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe();
  const logout = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!user) return null;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => setLocation("/login")
    });
  };

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
    { href: "/transactions", label: "Transactions", icon: ArrowRightLeft },
    { href: "/balances", label: "Balances", icon: Wallet },
    { href: "/buyers", label: "Buyers", icon: UserCircle },
    { href: "/members", label: "Members", icon: Users },
    { href: "/users", label: "Users & Admins", icon: ShieldCheck },
    { href: "/fees", label: "Fee Config", icon: Receipt },
    { href: "/statistics", label: "Statistics", icon: BarChart3 },
    { href: "/notices", label: "Notices", icon: Bell },
    { href: "/otp", label: "OTP Settings", icon: KeyRound },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className={`bg-sidebar border-r border-sidebar-border w-64 flex-shrink-0 flex flex-col transition-all duration-300 ${sidebarOpen ? "ml-0" : "-ml-64"}`}>
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border shrink-0">
          <span className="text-xl font-bold text-primary tracking-tight">TodoPay</span>
          <span className="ml-2 text-xs text-muted-foreground">ADMIN</span>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${location === item.href ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/50'}`}>
              <item.icon className="h-4 w-4" />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border shrink-0 bg-sidebar/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">{user.name}</span>
              <span className="text-xs text-muted-foreground">{user.loginId}</span>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase border-primary/30 text-primary">{user.role}</Badge>
          </div>
          <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground hover:text-foreground" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 border-b border-border bg-card flex items-center px-6 shrink-0 z-10 shadow-sm">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} className="mr-4 text-muted-foreground">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
        </header>
        
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
