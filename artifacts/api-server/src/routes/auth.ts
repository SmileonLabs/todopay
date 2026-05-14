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
  checkRateLimit,
  resetRateLimit,
} from "../lib/auth.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { loginId, password } = parsed.data;

  if (!checkRateLimit(loginId)) {
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

  resetRateLimit(loginId);

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
    },
    token,
  });
});

router.post("/auth/logout", (req, res) => {
  invalidateToken(req.headers.authorization);
  res.json({ success: true });
});

router.get("/auth/me", async (req, res) => {
  const parsed = verifyToken(req.headers.authorization);
  if (!parsed) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, parsed.id));
  if (!user) {
    res.status(401).json({ error: "User not found" });
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
    isActive: user.isActive,
    useOtp: user.useOtp,
    parentId: user.parentId ?? null,
    parentName: parent?.name ?? null,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
