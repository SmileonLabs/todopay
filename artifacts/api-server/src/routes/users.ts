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
import {
  requireAdmin,
  hashPassword,
  verifyPassword,
  invalidateAdminSessions,
} from "../lib/auth.js";
import { enforceCapability } from "../lib/access-control.js";
import {
  getScopedUserIds,
  hasDirectChildren,
  isUserInScope,
} from "../lib/organization-scope.js";
import { writeAuditLog } from "../lib/audit.js";
import { enforceTotp } from "../lib/otp-protection.js";
import { parsePositiveInteger } from "../lib/request-validation.js";

const router = Router();

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
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "organizations.read", res)) return;

  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const params = parsed.data;
  const page = parsePositiveInteger(params.page, 1, 1_000_000);
  const limit = parsePositiveInteger(params.limit, 100, 100);
  if (page === null || limit === null) {
    res.status(400).json({ error: "Invalid query parameters" }); return;
  }
  const offset = (page - 1) * limit;

  const scopedIds = await getScopedUserIds(caller);
  if (scopedIds.length === 0) {
    res.json({ items: [], total: 0 });
    return;
  }

  const conditions = [inArray(adminUsersTable.id, scopedIds)];
  if (params.role) {
    conditions.push(eq(adminUsersTable.role, params.role));
  }
  if (params.parentId !== undefined && params.parentId !== null) {
    if (params.parentId !== caller.id && !scopedIds.includes(params.parentId)) {
      res.json({ items: [], total: 0 });
      return;
    }
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
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "organizations.manage", res)) return;

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "입력값이 올바르지 않습니다" }); return; }

  const { loginId, password, name, role, permission, parentId, useOtp } = parsed.data;

  if (password.length < 8) {
    res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다" }); return;
  }

  const allowedRoles = CREATABLE_ROLES[caller.role] ?? [];
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: `${caller.role} 계정은 ${role} 계정을 생성할 수 없습니다` }); return;
  }

  const existingLoginId = await db.select().from(adminUsersTable).where(eq(adminUsersTable.loginId, loginId));
  if (existingLoginId.length > 0) {
    res.status(400).json({ error: "이미 사용 중인 아이디입니다" }); return;
  }

  const requiredParentRole = REQUIRED_PARENT_ROLE[role];
  let resolvedParentId: number | null = null;

  if (requiredParentRole) {
    if (caller.role === requiredParentRole) {
      resolvedParentId = caller.id;
    } else if (parentId) {
      const [parent] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, parentId));
      if (!parent) { res.status(400).json({ error: "상위 계정을 찾을 수 없습니다" }); return; }
      if (parent.role !== requiredParentRole) {
        res.status(400).json({ error: `${role} 계정의 상위는 ${requiredParentRole}이어야 합니다` }); return;
      }
      if (!(await isUserInScope(caller, parent.id, { includeSelf: true }))) {
        res.status(403).json({ error: "해당 상위 계정에 대한 권한이 없습니다" }); return;
      }
      resolvedParentId = parent.id;
    } else {
      res.status(400).json({ error: `${role} 계정을 생성하려면 상위 ${requiredParentRole} 계정을 선택해야 합니다` }); return;
    }
  }

  const [user] = await db.insert(adminUsersTable).values({
    loginId,
    passwordHash: await hashPassword(password),
    name,
    role,
    permission: permission ?? "admin",
    parentId: resolvedParentId,
    useOtp: useOtp ?? false,
  }).returning();

  res.status(201).json(formatUser(user));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "organization_user.create",
    resourceType: "admin_user",
    resourceId: user.id,
    metadata: { role: user.role, parentId: user.parentId, permission: user.permission },
  });
});

router.get("/users/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "organizations.read", res)) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const allowed = await isUserInScope(caller, id, { includeSelf: true });
  if (!allowed) { res.status(403).json({ error: "권한이 없습니다" }); return; }

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
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const isSelf = caller.id === id;
  if (!enforceCapability(
    caller,
    isSelf ? "profile.manage" : "organizations.manage",
    res,
  )) return;

  const allowed = await isUserInScope(caller, id, { includeSelf: true });
  if (!allowed) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  const updates: Partial<typeof adminUsersTable.$inferInsert> = {};

  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();

  if (!isSelf) {
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
    if (parsed.data.permission !== undefined) updates.permission = parsed.data.permission;
    if (parsed.data.useOtp !== undefined) updates.useOtp = parsed.data.useOtp;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "변경할 항목이 없습니다" }); return;
  }

  const [user] = await db.update(adminUsersTable).set(updates).where(eq(adminUsersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatUser(user));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: isSelf ? "profile.update" : "organization_user.update",
    resourceType: "admin_user",
    resourceId: user.id,
    metadata: { fields: Object.keys(updates) },
  });
});

router.delete("/users/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "organizations.manage", res)) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (caller.id === id) { res.status(403).json({ error: "자기 자신은 삭제할 수 없습니다" }); return; }

  const allowed = await isUserInScope(caller, id);
  if (!allowed) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  if (await hasDirectChildren(id)) {
    res.status(409).json({ error: "하부 조직이 있는 계정은 삭제할 수 없습니다" });
    return;
  }
  await db.delete(adminUsersTable).where(eq(adminUsersTable.id, id));
  res.status(204).send();
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "organization_user.delete",
    resourceType: "admin_user",
    resourceId: id,
  });
});

router.post("/users/:id/reset-password", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const isSelf = caller.id === id;
  if (!enforceCapability(
    caller,
    isSelf ? "profile.manage" : "organizations.manage",
    res,
  )) return;

  const parsed = ResetUserPasswordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  if (parsed.data.newPassword.length < 8) {
    res.status(400).json({ error: "비밀번호는 8자 이상이어야 합니다" }); return;
  }

  const allowed = await isUserInScope(caller, id, { includeSelf: true });
  if (!allowed) { res.status(403).json({ error: "권한이 없습니다" }); return; }
  if (isSelf) {
    if (!parsed.data.currentPassword) {
      res.status(400).json({ error: "현재 비밀번호를 입력해주세요" }); return;
    }
    if (!(await verifyPassword(parsed.data.currentPassword, caller.passwordHash))) {
      res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다" }); return;
    }
  }

  const result = await db.update(adminUsersTable)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword) })
    .where(eq(adminUsersTable.id, id))
    .returning({ id: adminUsersTable.id });

  if (result.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  await invalidateAdminSessions(id);
  res.json({ success: true });
  await writeAuditLog(req, {
    actorId: caller.id,
    action: isSelf ? "profile.password_update" : "organization_user.password_reset",
    resourceType: "admin_user",
    resourceId: id,
  });
});

router.patch("/users/:id/permission", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "organizations.manage", res)) return;
  if (!(await enforceTotp(caller, req, res, "sensitive"))) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (caller.id === id) { res.status(403).json({ error: "자신의 권한은 직접 변경할 수 없습니다" }); return; }

  const parsed = UpdateUserPermissionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  if (!["readonly", "admin", "finance"].includes(parsed.data.permission)) {
    res.status(400).json({ error: "지원하지 않는 권한입니다" });
    return;
  }

  const allowed = await isUserInScope(caller, id);
  if (!allowed) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  const [user] = await db.update(adminUsersTable)
    .set({ permission: parsed.data.permission })
    .where(eq(adminUsersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatUser(user));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "organization_user.permission_update",
    resourceType: "admin_user",
    resourceId: user.id,
    metadata: { permission: user.permission },
  });
});

export default router;
