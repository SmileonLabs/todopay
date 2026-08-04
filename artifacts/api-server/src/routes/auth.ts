import { Router } from "express";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import {
  signToken,
  invalidateToken,
  hashPassword,
  verifyPassword,
  checkRateLimit,
  resetRateLimit,
  requireAdmin,
} from "../lib/auth.js";
import { capabilitiesForUser } from "../lib/access-control.js";
import { writeAuditLog } from "../lib/audit.js";
import { isFinancialScopeReady } from "../lib/financial-scope.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { loginId, password } = parsed.data;

  const requestIp = (req.ip ?? "unknown").replace(/^::ffff:/, "");
  const [accountAllowed, ipAllowed] = await Promise.all([
    checkRateLimit(`admin-account:${loginId.toLowerCase()}`),
    checkRateLimit(`admin-ip:${requestIp}`, 100),
  ]);
  if (!accountAllowed || !ipAllowed) {
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

  await resetRateLimit(`admin-account:${loginId.toLowerCase()}`);

  if (!user.passwordHash.startsWith("scrypt:")) {
    const newHash = await hashPassword(password);
    await db.update(adminUsersTable)
      .set({ passwordHash: newHash })
      .where(eq(adminUsersTable.id, user.id));
  }

  const token = signToken(user.id, user.loginId);
  const parent = user.parentId
    ? await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, user.parentId)).then(r => r[0])
    : null;
  const financialScopeReady = await isFinancialScopeReady(user);

  res.json({
    user: {
      id: user.id,
      loginId: user.loginId,
      name: user.name,
      role: user.role,
      permission: user.permission,
      isActive: user.isActive,
      useOtp: user.useOtp,
      parentId: user.parentId ?? null,
      parentName: parent?.name ?? null,
      createdAt: user.createdAt.toISOString(),
      capabilities: capabilitiesForUser(user),
      financialScopeReady,
    },
    token,
  });
  await writeAuditLog(req, {
    actorId: user.id,
    action: "auth.login",
    resourceType: "admin_session",
    resourceId: user.id,
  });
});

router.post("/auth/logout", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization, { checkActive: false });
  await invalidateToken(req.headers.authorization);
  if (caller) {
    await writeAuditLog(req, {
      actorId: caller.id,
      action: "auth.logout",
      resourceType: "admin_session",
      resourceId: caller.id,
    });
  }
  res.json({ success: true });
});

router.get("/auth/me", async (req, res) => {
  const user = await requireAdmin(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parent = user.parentId
    ? await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, user.parentId)).then(r => r[0])
    : null;
  const financialScopeReady = await isFinancialScopeReady(user);
  res.json({
    id: user.id,
    loginId: user.loginId,
    name: user.name,
    role: user.role,
    permission: user.permission,
    isActive: user.isActive,
    useOtp: user.useOtp,
    parentId: user.parentId ?? null,
    parentName: parent?.name ?? null,
    createdAt: user.createdAt.toISOString(),
    capabilities: capabilitiesForUser(user),
    financialScopeReady,
  });
});

export default router;
