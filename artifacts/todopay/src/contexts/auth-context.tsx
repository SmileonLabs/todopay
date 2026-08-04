import React, { createContext, useContext, useEffect, useState } from "react";
import {
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";
import type { AdminUser } from "@workspace/api-client-react";

const TOKEN_KEY = "todopay_token";

interface AuthContextValue {
  user: AdminUser | null;
  token: string | null;
  isLoading: boolean;
  sessionMessage: string | null;
  signIn: (token: string, user: AdminUser) => void;
  signOut: () => void;
  clearSessionMessage: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));
    setUnauthorizedHandler(() => {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
      setSessionMessage("로그인 세션이 만료되었거나 더 이상 유효하지 않습니다. 다시 로그인해 주세요.");
    });
    return () => {
      setAuthTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json() as Promise<AdminUser>;
      })
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setSessionMessage("로그인 세션이 만료되었거나 더 이상 유효하지 않습니다. 다시 로그인해 주세요.");
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const signIn = (newToken: string, newUser: AdminUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    setSessionMessage(null);
  };

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setSessionMessage(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
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
