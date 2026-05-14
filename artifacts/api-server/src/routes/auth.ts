import { Router } from "express";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";

const router = Router();

function simpleHash(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { loginId, password } = parsed.data;
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.loginId, loginId));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const hash = simpleHash(password);
  if (user.passwordHash !== hash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = Buffer.from(`${user.id}:${user.loginId}:${Date.now()}`).toString("base64");
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

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

router.get("/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const [idStr] = decoded.split(":");
    const id = parseInt(idStr, 10);
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
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
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

export default router;
