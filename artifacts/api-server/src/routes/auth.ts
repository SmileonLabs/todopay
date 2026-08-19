import { Router } from "express";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import {
  signToken,
  verifyToken,
  invalidateToken,
  hashPassword,
  verifyPassword,
  requireAdmin,
} from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { allowRequest } from "../lib/rate-limit.js";
import { verifyUserTotp } from "../lib/mfa.js";
import { clearAdminSessionCookie, setAdminSessionCookie } from "../lib/session-cookie.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { loginId, password } = parsed.data;

  // Kept configurable for controlled development and PG integration testing.
  // Production must set this back to true before public launch.
  const loginRateLimitEnabled = process.env.ADMIN_LOGIN_RATE_LIMIT_ENABLED !== "false";
  if (loginRateLimitEnabled && !(await allowRequest("admin-login", `${req.ip ?? "unknown"}:${loginId}`, { limit: 10, windowSeconds: 15 * 60 }))) {
    res.status(429).json({ error: "로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도하세요." });
    return;
  }

  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.loginId, loginId));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.useOtp) {
    const otpCode = typeof req.body?.otpCode === "string" ? req.body.otpCode : "";
    if (!(await allowRequest("admin-mfa", `${req.ip ?? "unknown"}:${loginId}`, { limit: 10, windowSeconds: 15 * 60 }))) {
      res.status(429).json({ error: "OTP 시도 횟수를 초과했습니다. 15분 후 다시 시도하세요." });
      return;
    }
    if (!(await verifyUserTotp(user.id, otpCode))) {
      res.status(401).json({
        error: otpCode ? "OTP 코드가 올바르지 않습니다." : "OTP 코드가 필요합니다.",
        otpRequired: true,
      });
      return;
    }
  }

  if (!user.passwordHash.startsWith("scrypt:")) {
    const newHash = await hashPassword(password);
    await db.update(adminUsersTable)
      .set({ passwordHash: newHash })
      .where(eq(adminUsersTable.id, user.id));
  }

  const token = signToken(user.id, user.loginId, user.sessionVersion);
  setAdminSessionCookie(res, token);
  await writeAuditLog(req, { actorId: user.id, action: "admin.login", resourceType: "admin_user", resourceId: user.id });
  const parent = user.parentId
    ? await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, user.parentId)).then(r => r[0])
    : null;

  res.json({
    user: {
      id: user.id,
      loginId: user.loginId,
      name: user.name,
      role: user.role,
      permission: user.permission,
      merchantId: user.merchantId ?? null,
      isActive: user.isActive,
      useOtp: user.useOtp,
      parentId: user.parentId ?? null,
      parentName: parent?.name ?? null,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

router.post("/auth/logout", async (req, res) => {
  const user = await requireAdmin(req.headers.authorization, { checkActive: false });
  await invalidateToken(req.headers.authorization);
  clearAdminSessionCookie(res);
  if (user) await writeAuditLog(req, { actorId: user.id, action: "admin.logout", resourceType: "admin_user", resourceId: user.id });
  res.json({ success: true });
});

router.get("/auth/me", async (req, res) => {
  const parsed = await verifyToken(req.headers.authorization);
  if (!parsed) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, parsed.id));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  if (user.sessionVersion !== parsed.sessionVersion) {
    res.status(401).json({ error: "Session has been revoked" });
    return;
  }
  const parent = user.parentId
    ? await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, user.parentId)).then(r => r[0])
    : null;
  res.json({
    id: user.id,
    loginId: user.loginId,
    name: user.name,
    role: user.role,
    permission: user.permission,
    merchantId: user.merchantId ?? null,
    isActive: user.isActive,
    useOtp: user.useOtp,
    parentId: user.parentId ?? null,
    parentName: parent?.name ?? null,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
