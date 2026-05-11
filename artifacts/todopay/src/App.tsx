import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Login from "./pages/login";
import Dashboard from "./pages/dashboard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

function RedirectToDashboard() {
  const [, setLocation] = useLocation();
  setLocation("/dashboard");
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />

      <Route path="/">
        <RedirectToDashboard />
      </Route>

      <Route path="/dashboard">
        <Layout><Dashboard /></Layout>
      </Route>

      <Route path="/withdrawals">
        <Layout><div className="p-4 text-muted-foreground">출금 관리 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/transactions">
        <Layout><div className="p-4 text-muted-foreground">입출금 내역 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/balances">
        <Layout><div className="p-4 text-muted-foreground">충전금액 관리 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/buyers">
        <Layout><div className="p-4 text-muted-foreground">구매자 관리 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/members">
        <Layout><div className="p-4 text-muted-foreground">회원 관리 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/users">
        <Layout><div className="p-4 text-muted-foreground">유저 관리 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/fees">
        <Layout><div className="p-4 text-muted-foreground">수수료 설정 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/statistics">
        <Layout><div className="p-4 text-muted-foreground">일자별 통계 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/notices">
        <Layout><div className="p-4 text-muted-foreground">공지사항 페이지 준비 중</div></Layout>
      </Route>
      <Route path="/otp">
        <Layout><div className="p-4 text-muted-foreground">OTP 설정 페이지 준비 중</div></Layout>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
