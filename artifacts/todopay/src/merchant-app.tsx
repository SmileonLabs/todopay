import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import MemberRegister from "./pages/member-register";
import MemberLogin from "./pages/member-login";
import Landing from "./pages/landing";

const PARTNER_PORTAL_URL = "https://partner.todopay.io/";
const LEGACY_ADMIN_ROUTES = [
  "/login",
  "/dashboard",
  "/withdrawals",
  "/transactions",
  "/balances",
  "/settlement",
  "/members",
  "/users",
  "/fees",
  "/statistics",
  "/notices",
  "/otp",
  "/profile",
] as const;

function PartnerPortalRedirect() {
  useEffect(() => {
    window.location.replace(PARTNER_PORTAL_URL);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <p className="text-sm text-muted-foreground">
        TodoPay 파트너 관리자로 이동합니다.{" "}
        <a className="text-primary underline" href={PARTNER_PORTAL_URL}>바로 이동</a>
      </p>
    </main>
  );
}

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
      <Route path="/register/member" component={MemberRegister} />
      <Route path="/member/login" component={MemberLogin} />

      <Route path="/">
        <Landing />
      </Route>

      {LEGACY_ADMIN_ROUTES.map((path) => (
        <Route key={path} path={path} component={PartnerPortalRedirect} />
      ))}

      <Route component={NotFound} />
    </Switch>
  );
}

export default function MerchantApp() {
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
