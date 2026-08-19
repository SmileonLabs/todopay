import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_COOKIE, MEMBER_SESSION_COOKIE, clearAdminSessionCookie,
  promoteSessionCookie, setAdminSessionCookie,
} from "./session-cookie.js";

describe("session cookies", () => {
  it("promotes the correct HttpOnly session when no bearer header exists", () => {
    const admin = { path: "/api/platform/overview", headers: {}, cookies: { [ADMIN_SESSION_COOKIE]: "admin-token" } };
    promoteSessionCookie(admin as never);
    expect(admin.headers).toEqual({ authorization: "Bearer admin-token" });

    const member = { path: "/api/member/auth/me", headers: {}, cookies: { [MEMBER_SESSION_COOKIE]: "member-token" } };
    promoteSessionCookie(member as never);
    expect(member.headers).toEqual({ authorization: "Bearer member-token" });
  });

  it("does not override explicit API bearer authentication", () => {
    const req = { path: "/api/platform/overview", headers: { authorization: "Bearer explicit" }, cookies: { [ADMIN_SESSION_COOKIE]: "cookie" } };
    promoteSessionCookie(req as never);
    expect(req.headers.authorization).toBe("Bearer explicit");
  });

  it("sets and clears a strict HttpOnly cookie", () => {
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };
    setAdminSessionCookie(res as never, "secret");
    clearAdminSessionCookie(res as never);
    expect(res.cookie).toHaveBeenCalledWith(ADMIN_SESSION_COOKIE, "secret", expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/api" }));
    expect(res.clearCookie).toHaveBeenCalledWith(ADMIN_SESSION_COOKIE, expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/api" }));
  });
});
