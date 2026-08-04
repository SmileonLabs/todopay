import { Router } from "express";
import {
  adminUsersTable,
  db,
  integrationMappingsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import {
  canManageStoreMapping,
  enforceCapability,
} from "../lib/access-control.js";
import { getScopedUserIds, isUserInScope } from "../lib/organization-scope.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();
const STORE_CODE = /^[A-Za-z0-9_.-]{2,50}$/;

router.get("/integration-mappings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "organizations.read", res)) return;

  const scopedIds = await getScopedUserIds(caller, { includeSelf: true });
  if (scopedIds.length === 0) { res.json({ items: [] }); return; }
  const rows = await db
    .select({
      id: integrationMappingsTable.id,
      userId: integrationMappingsTable.localEntityId,
      storeCode: integrationMappingsTable.todoPayEntityId,
      status: integrationMappingsTable.syncStatus,
      lastVerifiedAt: integrationMappingsTable.lastVerifiedAt,
      updatedAt: integrationMappingsTable.updatedAt,
    })
    .from(integrationMappingsTable)
    .where(and(
      eq(integrationMappingsTable.localEntityType, "admin_user"),
      eq(integrationMappingsTable.todoPayEntityType, "store_code"),
      inArray(integrationMappingsTable.localEntityId, scopedIds),
    ));
  res.json({ items: rows });
});

router.put("/integration-mappings/users/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!canManageStoreMapping(caller)) {
    res.status(403).json({
      error: "매장코드 연결은 상위 조직 관리자만 변경할 수 있습니다.",
      code: "STORE_MAPPING_SELF_MANAGEMENT_FORBIDDEN",
    });
    return;
  }
  if (!enforceCapability(caller, "organizations.manage", res)) return;

  const userId = Number(req.params.id);
  const storeCode = typeof req.body?.storeCode === "string" ? req.body.storeCode.trim() : "";
  if (!Number.isSafeInteger(userId) || userId <= 0 || !STORE_CODE.test(storeCode)) {
    res.status(400).json({ error: "유효한 매장 사용자와 TodoPay 매장코드가 필요합니다." });
    return;
  }
  if (!(await isUserInScope(caller, userId, { includeSelf: true }))) {
    res.status(403).json({ error: "권한이 없습니다." }); return;
  }
  const [target] = await db.select({ role: adminUsersTable.role })
    .from(adminUsersTable).where(eq(adminUsersTable.id, userId)).limit(1);
  if (!target || target.role !== "store") {
    res.status(400).json({ error: "매장 계정만 TodoPay 매장코드와 연결할 수 있습니다." });
    return;
  }

  const [mapping] = await db.insert(integrationMappingsTable).values({
    localEntityType: "admin_user",
    localEntityId: userId,
    todoPayEntityType: "store_code",
    todoPayEntityId: storeCode,
    syncStatus: "active",
    lastVerifiedAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [
      integrationMappingsTable.localEntityType,
      integrationMappingsTable.localEntityId,
    ],
    set: {
      todoPayEntityType: "store_code",
      todoPayEntityId: storeCode,
      syncStatus: "active",
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();

  await writeAuditLog(req, {
    actorId: caller.id,
    action: "integration_mapping.upsert",
    resourceType: "admin_user",
    resourceId: userId,
    metadata: { storeCode },
  });
  res.json(mapping);
});

router.delete("/integration-mappings/users/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!canManageStoreMapping(caller)) {
    res.status(403).json({
      error: "매장코드 연결은 상위 조직 관리자만 변경할 수 있습니다.",
      code: "STORE_MAPPING_SELF_MANAGEMENT_FORBIDDEN",
    });
    return;
  }
  if (!enforceCapability(caller, "organizations.manage", res)) return;
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || !(await isUserInScope(caller, userId, { includeSelf: true }))) {
    res.status(403).json({ error: "권한이 없습니다." }); return;
  }
  await db.delete(integrationMappingsTable).where(and(
    eq(integrationMappingsTable.localEntityType, "admin_user"),
    eq(integrationMappingsTable.localEntityId, userId),
  ));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "integration_mapping.delete",
    resourceType: "admin_user",
    resourceId: userId,
  });
  res.status(204).end();
});

export default router;
