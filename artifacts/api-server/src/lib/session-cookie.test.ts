import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_COOKIE,
  MEMBER_SESSION_COOKIE,
  clearAdminSessionCookie,
  promoteSessionCookie,
  setAdminSessionCookie,
} from "./session-cookie.js";

describe("session cookies", () => {
  it("promotes the correct HttpOnly session when no bearer header exists", () => {
    const next = vi.fn();
    const admin = {
      path: "/api/platform/overview",
      headers: {},
      cookies: { [ADMIN_SESSION_COOKIE]: "admin-token" },
    };
    promoteSessionCookie(admin as never, {} as never, next);
    expect(admin.headers).toEqual({ authorization: "Bearer admin-token" });

    const member = {
      path: "/api/member/auth/me",
      headers: {},
      cookies: { [MEMBER_SESSION_COOKIE]: "member-token" },
    };
    promoteSessionCookie(member as never, {} as never, next);
    expect(member.headers).toEqual({ authorization: "Bearer member-token" });
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("does not override explicit API bearer authentication", () => {
    const next = vi.fn();
    const req = {
      path: "/api/platform/overview",
      headers: { authorization: "Bearer explicit" },
      cookies: { [ADMIN_SESSION_COOKIE]: "cookie" },
    };
    promoteSessionCookie(req as never, {} as never, next);
    expect(req.headers.authorization).toBe("Bearer explicit");
    expect(next).toHaveBeenCalledOnce();
  });

  it("always continues requests without a session cookie", () => {
    const next = vi.fn();
    promoteSessionCookie(
      { path: "/api/auth/me", headers: {}, cookies: {} } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("sets and clears a strict HttpOnly cookie", () => {
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };
    setAdminSessionCookie(res as never, "secret");
    clearAdminSessionCookie(res as never);
    expect(res.cookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE,
      "secret",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/api",
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/api",
      }),
    );
  });
});
