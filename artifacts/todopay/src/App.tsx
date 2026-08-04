import { lazy, Suspense } from "react";

const MerchantApp = lazy(() => import("./merchant-app"));
const PlatformApp = lazy(() => import("./platform-console"));
const PartnerApp = lazy(() => import("./partner-portal-v5"));

function LoadingScreen() {
  return <div className="min-h-screen bg-background" />;
}

export default function App() {
  const mode = import.meta.env.VITE_APP_MODE;

  return (
    <Suspense fallback={<LoadingScreen />}>
      {mode === "platform" ? <PlatformApp /> : mode === "partner" ? <PartnerApp /> : <MerchantApp />}
    </Suspense>
  );
}
