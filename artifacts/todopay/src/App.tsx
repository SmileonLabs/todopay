import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Withdrawals from "./pages/withdrawals";
import Transactions from "./pages/transactions";
import Balances from "./pages/balances";
import Buyers from "./pages/buyers";
import Members from "./pages/members";
import Users from "./pages/users";
import Fees from "./pages/fees";
import Statistics from "./pages/statistics";
import Notices from "./pages/notices";
import Otp from "./pages/otp";
import Profile from "./pages/profile";
import BuyerRegister from "./pages/buyer-register";

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
      <Route path="/register/buyer" component={BuyerRegister} />

      <Route path="/">
        <RedirectToDashboard />
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
      <Route path="/buyers">
        <Layout><Buyers /></Layout>
      </Route>
      <Route path="/members">
        <Layout><Members /></Layout>
      </Route>
      <Route path="/users">
        <Layout><Users /></Layout>
      </Route>
      <Route path="/fees">
        <Layout><Fees /></Layout>
      </Route>
      <Route path="/statistics">
        <Layout><Statistics /></Layout>
      </Route>
      <Route path="/notices">
        <Layout><Notices /></Layout>
      </Route>
      <Route path="/otp">
        <Layout><Otp /></Layout>
      </Route>
      <Route path="/profile">
        <Layout><Profile /></Layout>
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
