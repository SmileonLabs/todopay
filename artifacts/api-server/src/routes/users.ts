import { Router } from "express";
import { db, adminUsersTable } from "@workspace/db";
import { eq, ilike, and, or, inArray, sql } from "drizzle-orm";
import {
  ListUsersQueryParams,
  CreateUserBody,
  UpdateUserBody,
  ResetUserPasswordBody,
  UpdateUserPermissionBody,
} from "@workspace/api-zod";

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

function formatUser(user: typeof adminUsersTable.$inferSelect, parentName?: string | null) {
  return {
    id: user.id,
    loginId: user.loginId,
    name: user.name,
    role: user.role,
    permission: user.permission,
    isActive: user.isActive,
    useOtp: user.useOtp,
    parentId: user.parentId ?? null,
    parentName: parentName ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

async function getCallerFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    if (isNaN(id)) return null;
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
    return user ?? null;
  } catch {
    return null;
  }
}

const CREATABLE_ROLES: Record<string, string[]> = {
  superadmin: ["hq", "distributor", "agency", "store"],
  hq:         ["distributor", "agency", "store"],
  distributor:["agency", "store"],
  agency:     ["store"],
  store:      [],
};

const REQUIRED_PARENT_ROLE: Record<string, string | null> = {
  hq:          null,
  distributor: "hq",
  agency:      "distributor",
  store:       "agency",
};

router.get("/users", async (req, res) => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.role) conditions.push(eq(adminUsersTable.role, params.role));
  if (params.parentId !== undefined && params.parentId !== null) {
    conditions.push(eq(adminUsersTable.parentId, params.parentId));
  }
  if (params.search) {
    conditions.push(
      or(
        ilike(adminUsersTable.name, `%${params.search}%`),
        ilike(adminUsersTable.loginId, `%${params.search}%`)
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [users, [{ count }]] = await Promise.all([
    db.select().from(adminUsersTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(adminUsersTable).where(where),
  ]);

  const parentIds = [...new Set(users.map(u => u.parentId).filter(Boolean))] as number[];
  const parents = parentIds.length > 0
    ? await db.select().from(adminUsersTable).where(inArray(adminUsersTable.id, parentIds))
    : [];
  const parentMap = new Map(parents.map(p => [p.id, p.name]));

  res.json({
    items: users.map(u => formatUser(u, parentMap.get(u.parentId ?? 0))),
    total: Number(count),
  });
});

router.post("/users", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller || !caller.isActive) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값이 올바르지 않습니다" });
    return;
  }

  const { loginId, password, name, role, permission, parentId, useOtp } = parsed.data;

  const allowedRoles = CREATABLE_ROLES[caller.role] ?? [];
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: `${caller.role} 계정은 ${role} 계정을 생성할 수 없습니다` });
    return;
  }

  const existingLoginId = await db.select().from(adminUsersTable).where(eq(adminUsersTable.loginId, loginId));
  if (existingLoginId.length > 0) {
    res.status(400).json({ error: "이미 사용 중인 아이디입니다" });
    return;
  }

  const requiredParentRole = REQUIRED_PARENT_ROLE[role];
  let resolvedParentId: number | null = null;

  if (requiredParentRole) {
    if (caller.role === requiredParentRole) {
      resolvedParentId = caller.id;
    } else if (parentId) {
      const [parent] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, parentId));
      if (!parent) {
        res.status(400).json({ error: "상위 계정을 찾을 수 없습니다" });
        return;
      }
      if (parent.role !== requiredParentRole) {
        res.status(400).json({ error: `${role} 계정의 상위는 ${requiredParentRole}이어야 합니다` });
        return;
      }
      resolvedParentId = parent.id;
    } else {
      res.status(400).json({ error: `${role} 계정을 생성하려면 상위 ${requiredParentRole} 계정을 선택해야 합니다` });
      return;
    }
  }

  const [user] = await db.insert(adminUsersTable).values({
    loginId,
    passwordHash: simpleHash(password),
    name,
    role,
    permission: permission ?? "admin",
    parentId: resolvedParentId,
    useOtp: useOtp ?? false,
  }).returning();

  res.status(201).json(formatUser(user));
});

router.get("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  let parentName: string | null = null;
  if (user.parentId) {
    const [parent] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, user.parentId));
    parentName = parent?.name ?? null;
  }
  res.json(formatUser(user, parentName));
});

router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates: Partial<typeof adminUsersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.permission !== undefined) updates.permission = parsed.data.permission;
  if (parsed.data.useOtp !== undefined) updates.useOtp = parsed.data.useOtp;
  const [user] = await db.update(adminUsersTable).set(updates).where(eq(adminUsersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatUser(user));
});

router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(adminUsersTable).where(eq(adminUsersTable.id, id));
  res.status(204).send();
});

router.post("/users/:id/reset-password", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = ResetUserPasswordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  await db.update(adminUsersTable)
    .set({ passwordHash: simpleHash(parsed.data.newPassword) })
    .where(eq(adminUsersTable.id, id));
  res.json({ success: true });
});

router.patch("/users/:id/permission", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateUserPermissionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [user] = await db.update(adminUsersTable)
    .set({ permission: parsed.data.permission })
    .where(eq(adminUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatUser(user));
});

export default router;
