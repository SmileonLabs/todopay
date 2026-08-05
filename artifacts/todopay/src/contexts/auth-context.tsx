import React, { createContext, useContext, useEffect, useState } from "react";
import {
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";
import type { AdminUser } from "@workspace/api-client-react";

interface AuthContextValue {
  user: AdminUser | null;
  isLoading: boolean;
  sessionMessage: string | null;
  signIn: (user: AdminUser) => void;
  signOut: () => void;
  clearSessionMessage: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  useEffect(() => {
    // Admin sessions are held in an HttpOnly SameSite cookie. Keeping the
    // bearer token out of Web Storage prevents persistent token theft by XSS.
    setAuthTokenGetter(null);
    setUnauthorizedHandler(() => {
      setUser(null);
      setSessionMessage("로그인 세션이 만료되었거나 더 이상 유효하지 않습니다. 다시 로그인해 주세요.");
    });
    return () => {
      setAuthTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json() as Promise<AdminUser>;
      })
      .then((u) => setUser(u))
      .catch(() => {
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const signIn = (newUser: AdminUser) => {
    setUser(newUser);
    setSessionMessage(null);
  };

  const signOut = () => {
    setUser(null);
    setSessionMessage(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      sessionMessage,
      signIn,
      signOut,
      clearSessionMessage: () => setSessionMessage(null),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
