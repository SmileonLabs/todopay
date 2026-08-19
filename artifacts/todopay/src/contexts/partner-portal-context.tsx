import { createContext, useContext, type ReactNode } from "react";
import type { usePartnerPortalState } from "@/hooks/use-partner-portal";

type PartnerPortalState = ReturnType<typeof usePartnerPortalState>;
const Context = createContext<PartnerPortalState | null>(null);

export function PartnerPortalProvider({
  value,
  children,
}: {
  value: PartnerPortalState;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePartnerPortalContext(): PartnerPortalState {
  const value = useContext(Context);
  if (!value)
    throw new Error(
      "usePartnerPortalContext must be used inside PartnerPortalProvider",
    );
  return value;
}
