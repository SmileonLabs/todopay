import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { CapabilityGuard } from "@/components/capability-guard";

const Login = lazy(() => import("./pages/login"));
const Dashboard = lazy(() => import("./pages/todopay-dashboard"));
const Withdrawals = lazy(() => import("./pages/todopay-withdrawals"));
const Transactions = lazy(() => import("./pages/todopay-transactions"));
const Balances = lazy(() => import("./pages/todopay-balance"));
const Members = lazy(() => import("./pages/todopay-members"));
const Users = lazy(() => import("./pages/users"));
const Fees = lazy(() => import("./pages/fees"));
const Statistics = lazy(() => import("./pages/statistics"));
const Notices = lazy(() => import("./pages/notices"));
const Otp = lazy(() => import("./pages/otp"));
const Profile = lazy(() => import("./pages/profile"));
const MemberLogin = lazy(() => import("./pages/member-login"));
const MemberAccess = lazy(() => import("./pages/member-access"));
const Landing = lazy(() => import("./pages/landing"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register/member" component={MemberAccess} />
      <Route path="/member/login" component={MemberAccess} />
      <Route path="/member/portal" component={MemberLogin} />

      <Route path="/">
        <Landing />
      </Route>

      <Route path="/dashboard">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/withdrawals">
        <Layout><Withdrawals /></Layout>
      </Route>
      <Route path="/transactions">
        <Layout><Transactions /></Layout>
      </Route>
      <Route path="/balances">
        <Layout><Balances /></Layout>
      </Route>
      <Route path="/settlement">
        <Layout><Balances /></Layout>
      </Route>
      <Route path="/members">
        <Layout><Members /></Layout>
      </Route>
      <Route path="/users">
        <Layout><CapabilityGuard capability="organizations.read"><Users /></CapabilityGuard></Layout>
      </Route>
      <Route path="/fees">
        <Layout><CapabilityGuard capability="fees.read"><Fees /></CapabilityGuard></Layout>
      </Route>
      <Route path="/statistics">
        <Layout><CapabilityGuard capability="statistics.read"><Statistics /></CapabilityGuard></Layout>
      </Route>
      <Route path="/notices">
        <Layout><CapabilityGuard capability="notices.read"><Notices /></CapabilityGuard></Layout>
      </Route>
      <Route path="/otp">
        <Layout><CapabilityGuard capability="otp.manage"><Otp /></CapabilityGuard></Layout>
      </Route>
      <Route path="/profile">
        <Layout><CapabilityGuard capability="profile.manage"><Profile /></CapabilityGuard></Layout>
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
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">화면을 불러오는 중입니다.</div>}>
              <Router />
            </Suspense>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
