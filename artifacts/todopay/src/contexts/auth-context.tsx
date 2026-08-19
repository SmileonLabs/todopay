import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AdminUser } from "@workspace/api-client-react";

type AuthStatus = "checking" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (user: AdminUser) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", {
      credentials: "include",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json() as Promise<AdminUser>;
      })
      .then((authenticatedUser) => {
        setUser(authenticatedUser);
        setStatus("authenticated");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setUser(null);
        setStatus("anonymous");
      });
    return () => controller.abort();
  }, []);

  const signIn = useCallback((newUser: AdminUser) => {
    setUser(newUser);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const isLoading = status === "checking";
  const isAuthenticated = status === "authenticated";

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated, isLoading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
