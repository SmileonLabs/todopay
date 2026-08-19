import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
} from "react";

const MerchantApp = lazy(() => import("./merchant-app"));
const PlatformApp = lazy(() => import("./platform-console"));
const PartnerApp = lazy(() => import("./partner-portal-v5"));

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">
          화면을 준비하고 있습니다.
        </p>
      </div>
    </div>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">화면을 표시하지 못했습니다.</h1>
          <p className="text-sm text-muted-foreground">
            일시적인 화면 오류가 발생했습니다. 다시 불러온 뒤에도 계속되면 운영
            담당자에게 문의해 주세요.
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  const mode = import.meta.env.VITE_APP_MODE;

  return (
    <AppErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        {mode === "platform" ? (
          <PlatformApp />
        ) : mode === "partner" ? (
          <PartnerApp />
        ) : (
          <MerchantApp />
        )}
      </Suspense>
    </AppErrorBoundary>
  );
}
