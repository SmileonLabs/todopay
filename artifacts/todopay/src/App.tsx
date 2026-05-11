import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Login from "./pages/login";
import Dashboard from "./pages/dashboard";

const queryClient = new QueryClient();

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
      
      {/* Add placeholders for other routes */}
      <Route path="/withdrawals"><Layout><div className="p-4">Withdrawals Page</div></Layout></Route>
      <Route path="/transactions"><Layout><div className="p-4">Transactions Page</div></Layout></Route>
      <Route path="/balances"><Layout><div className="p-4">Balances Page</div></Layout></Route>
      <Route path="/buyers"><Layout><div className="p-4">Buyers Page</div></Layout></Route>
      <Route path="/members"><Layout><div className="p-4">Members Page</div></Layout></Route>
      <Route path="/users"><Layout><div className="p-4">Users Page</div></Layout></Route>
      <Route path="/fees"><Layout><div className="p-4">Fees Page</div></Layout></Route>
      <Route path="/statistics"><Layout><div className="p-4">Statistics Page</div></Layout></Route>
      <Route path="/notices"><Layout><div className="p-4">Notices Page</div></Layout></Route>
      <Route path="/otp"><Layout><div className="p-4">OTP Page</div></Layout></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
