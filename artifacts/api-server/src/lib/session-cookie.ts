import type { CookieOptions, NextFunction, Request, Response } from "express";

export const ADMIN_SESSION_COOKIE = "todopay_admin_session";
export const MEMBER_SESSION_COOKIE = "todopay_member_session";

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function options(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
    maxAge: SESSION_MAX_AGE_MS,
    ...(process.env.SESSION_COOKIE_DOMAIN
      ? { domain: process.env.SESSION_COOKIE_DOMAIN }
      : {}),
  };
}

function clearOptions(): CookieOptions {
  const { maxAge: _maxAge, ...rest } = options();
  return rest;
}

export function setAdminSessionCookie(res: Response, token: string): void {
  res.cookie(ADMIN_SESSION_COOKIE, token, options());
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE, clearOptions());
}

export function setMemberSessionCookie(res: Response, token: string): void {
  res.cookie(MEMBER_SESSION_COOKIE, token, options());
}

export function clearMemberSessionCookie(res: Response): void {
  res.clearCookie(MEMBER_SESSION_COOKIE, clearOptions());
}

/**
 * Keep the existing authorization helpers and non-browser clients compatible
 * while making an HttpOnly cookie the browser default.
 */
export function promoteSessionCookie(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.headers.authorization) {
    const cookies = req.cookies as
      | Record<string, string | undefined>
      | undefined;
    const isMemberRoute = req.path.startsWith("/api/member/");
    const token =
      cookies?.[isMemberRoute ? MEMBER_SESSION_COOKIE : ADMIN_SESSION_COOKIE];
    if (token) req.headers.authorization = `Bearer ${token}`;
  }
  next();
}
