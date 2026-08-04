import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { adminUsersTable, db, merchantsTable } from "@workspace/db";
import { hashPassword, isPlatformAdmin, requireAdmin } from "../lib/auth.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();
const merchantCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/;
const partnerLoginIdPattern = /^[A-Za-z0-9_.-]{3,50}$/;
const statuses = new Set(["pending", "active", "suspended", "terminated"]);
const ipPattern = /^[0-9a-fA-F:.\/]{1,64}$/;

function publicMerchant(row: typeof merchantsTable.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    adminDomain: row.adminDomain,
    apiKeyPrefix: row.apiKeyPrefix,
    webhookUrl: row.webhookUrl,
    allowedIps: row.allowedIps ?? [],
    dailyWithdrawalLimit: row.dailyWithdrawalLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requirePlatform(req: Request, res: Response) {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!isPlatformAdmin(caller)) {
    res.status(403).json({ error: "Platform administrator required" });
    return null;
  }
  return caller;
}

router.get("/platform/merchants", async (req, res) => {
  if (!(await requirePlatform(req, res))) return;
  const page = Math.max(
    1,
    Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
  );
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
  );
  const search =
    typeof req.query.search === "string"
      ? req.query.search.trim().slice(0, 100)
      : "";
  const status =
    typeof req.query.status === "string" && statuses.has(req.query.status)
      ? req.query.status
      : "";
  const conditions = [];
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    conditions.push(
      or(
        ilike(merchantsTable.code, pattern),
        ilike(merchantsTable.name, pattern),
      )!,
    );
  }
  if (status) conditions.push(eq(merchantsTable.status, status));
  const where = conditions.length
    ? sql.join(conditions, sql` and `)
    : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(merchantsTable)
      .where(where)
      .orderBy(asc(merchantsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: sql<number>`count(*)` })
      .from(merchantsTable)
      .where(where),
  ]);
  res.json({
    merchants: rows.map(publicMerchant),
    pagination: {
      page,
      limit,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / limit)),
    },
  });
});

router.post("/platform/merchants", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const {
    code,
    name,
    partnerOperator,
    adminDomain,
    webhookUrl,
    allowedIps,
    dailyWithdrawalLimit,
  } = req.body ?? {};
  const normalizedCode =
    typeof code === "string" ? code.trim().toUpperCase() : "";
  if (
    !merchantCodePattern.test(normalizedCode) ||
    typeof name !== "string" ||
    !name.trim()
  ) {
    res.status(400).json({ error: "Invalid merchant code or name" });
    return;
  }
  const operatorLoginId =
    typeof partnerOperator?.loginId === "string"
      ? partnerOperator.loginId.trim()
      : "";
  const operatorName =
    typeof partnerOperator?.name === "string"
      ? partnerOperator.name.trim()
      : "";
  const operatorPassword =
    typeof partnerOperator?.password === "string"
      ? partnerOperator.password
      : "";
  if (
    !partnerLoginIdPattern.test(operatorLoginId) ||
    !operatorName ||
    operatorPassword.length < 12
  ) {
    res.status(400).json({ error: "Invalid partner operator details" });
    return;
  }
  if (
    adminDomain != null &&
    (typeof adminDomain !== "string" || !/^[a-z0-9.-]+$/i.test(adminDomain))
  ) {
    res.status(400).json({ error: "Invalid admin domain" });
    return;
  }
  if (
    webhookUrl != null &&
    (typeof webhookUrl !== "string" ||
      (webhookUrl.trim() && !/^https:\/\//i.test(webhookUrl)))
  ) {
    res.status(400).json({ error: "Webhook URL must use HTTPS" });
    return;
  }
  if (
    allowedIps != null &&
    (!Array.isArray(allowedIps) ||
      allowedIps.some(
        (value) => typeof value !== "string" || !ipPattern.test(value),
      ))
  ) {
    res.status(400).json({ error: "Invalid allowed IP" });
    return;
  }
  const [[duplicateMerchant], [duplicateOperator]] = await Promise.all([
    db
      .select({ id: merchantsTable.id })
      .from(merchantsTable)
      .where(eq(merchantsTable.code, normalizedCode))
      .limit(1),
    db
      .select({ id: adminUsersTable.id })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.loginId, operatorLoginId))
      .limit(1),
  ]);
  if (duplicateMerchant) {
    res.status(409).json({ error: "Merchant code is already in use" });
    return;
  }
  if (duplicateOperator) {
    res.status(409).json({ error: "Partner login ID is already in use" });
    return;
  }

  const passwordHash = await hashPassword(operatorPassword);
  let result;
  try {
    result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(merchantsTable)
        .values({
          code: normalizedCode,
          name: name.trim(),
          // Retained only for backwards compatibility. New merchants use the
          // shared partner.todopay.io portal and leave this value unset.
          adminDomain: adminDomain?.trim().toLowerCase() || null,
          webhookUrl:
            typeof webhookUrl === "string" ? webhookUrl.trim() || null : null,
          allowedIps: Array.isArray(allowedIps) ? allowedIps : [],
          dailyWithdrawalLimit:
            Number.isSafeInteger(dailyWithdrawalLimit) &&
            dailyWithdrawalLimit >= 0
              ? dailyWithdrawalLimit
              : 0,
        })
        .returning();
      const [operator] = await tx
        .insert(adminUsersTable)
        .values({
          loginId: operatorLoginId,
          passwordHash,
          name: operatorName,
          role: "hq",
          permission: "admin",
          merchantId: created.id,
          parentId: null,
          isActive: true,
          useOtp: false,
        })
        .returning();
      return { created, operator };
    });
  } catch (error) {
    const databaseCode =
      error && typeof error === "object"
        ? ((error as { code?: string; cause?: { code?: string } }).code ??
          (error as { cause?: { code?: string } }).cause?.code)
        : undefined;
    if (databaseCode === "23505") {
      res.status(409).json({ error: "Merchant code or login ID is already in use" });
      return;
    }
    throw error;
  }
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "merchant.create",
    resourceType: "merchant",
    resourceId: result.created.id,
    metadata: {
      code: result.created.code,
      operatorId: result.operator.id,
      operatorLoginId: result.operator.loginId,
    },
  });
  res.status(201).json({
    merchant: publicMerchant(result.created),
    operator: {
      id: result.operator.id,
      loginId: result.operator.loginId,
      name: result.operator.name,
      role: result.operator.role,
      merchantId: result.operator.merchantId,
    },
  });
});

router.patch("/platform/merchants/:merchantId", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId)) {
    res.status(400).json({ error: "Invalid merchant id" });
    return;
  }
  const body = req.body ?? {};
  if (body.status != null && !statuses.has(body.status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  if (
    body.adminDomain != null &&
    (typeof body.adminDomain !== "string" ||
      (body.adminDomain.trim() && !/^[a-z0-9.-]+$/i.test(body.adminDomain)))
  ) {
    res.status(400).json({ error: "Invalid admin domain" });
    return;
  }
  if (
    body.webhookUrl != null &&
    (typeof body.webhookUrl !== "string" ||
      (body.webhookUrl.trim() && !/^https:\/\//i.test(body.webhookUrl)))
  ) {
    res.status(400).json({ error: "Webhook URL must use HTTPS" });
    return;
  }
  if (
    body.allowedIps != null &&
    (!Array.isArray(body.allowedIps) ||
      body.allowedIps.some(
        (value: unknown) => typeof value !== "string" || !ipPattern.test(value),
      ))
  ) {
    res.status(400).json({ error: "Invalid allowed IP" });
    return;
  }
  const update = {
    ...(typeof body.name === "string" && body.name.trim()
      ? { name: body.name.trim() }
      : {}),
    ...(typeof body.status === "string" ? { status: body.status } : {}),
    ...(typeof body.adminDomain === "string"
      ? { adminDomain: body.adminDomain.trim().toLowerCase() || null }
      : {}),
    ...(typeof body.webhookUrl === "string"
      ? { webhookUrl: body.webhookUrl.trim() || null }
      : {}),
    ...(Array.isArray(body.allowedIps)
      ? { allowedIps: body.allowedIps as string[] }
      : {}),
    ...(Number.isSafeInteger(body.dailyWithdrawalLimit) &&
    body.dailyWithdrawalLimit >= 0
      ? { dailyWithdrawalLimit: body.dailyWithdrawalLimit }
      : {}),
    updatedAt: new Date(),
  };
  const [updated] = await db
    .update(merchantsTable)
    .set(update)
    .where(eq(merchantsTable.id, merchantId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "merchant.update",
    resourceType: "merchant",
    resourceId: updated.id,
    metadata: { status: updated.status },
  });
  res.json({ merchant: publicMerchant(updated) });
});

router.post("/platform/merchants/:merchantId/api-key", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId)) {
    res.status(400).json({ error: "Invalid merchant id" });
    return;
  }
  const rawKey = `tp_live_${crypto.randomBytes(32).toString("base64url")}`;
  const apiKeyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const [updated] = await db
    .update(merchantsTable)
    .set({
      apiKeyHash,
      apiKeyPrefix: rawKey.slice(0, 14),
      updatedAt: new Date(),
    })
    .where(eq(merchantsTable.id, merchantId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "merchant.api_key.rotate",
    resourceType: "merchant",
    resourceId: merchantId,
  });
  // The raw key is deliberately returned only at creation/rotation time.
  res.json({ apiKey: rawKey, apiKeyPrefix: updated.apiKeyPrefix });
});

router.delete("/platform/merchants/:merchantId/api-key", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId) || merchantId <= 0) {
    res.status(400).json({ error: "Invalid merchant id" });
    return;
  }
  const [updated] = await db
    .update(merchantsTable)
    .set({ apiKeyHash: null, apiKeyPrefix: null, updatedAt: new Date() })
    .where(eq(merchantsTable.id, merchantId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "merchant.api_key.revoke",
    resourceType: "merchant",
    resourceId: merchantId,
  });
  res.json({ success: true });
});

/** Create or rebind the single administrator used by a merchant's partner portal.
 * This endpoint intentionally cannot target platform operators or another merchant. */
router.put(
  "/platform/merchants/:merchantId/partner-operator",
  async (req, res) => {
    const caller = await requirePlatform(req, res);
    if (!caller) return;
    const merchantId = Number(req.params.merchantId);
    const { loginId, password, name } = req.body ?? {};
    if (
      !Number.isSafeInteger(merchantId) ||
      typeof loginId !== "string" ||
      !partnerLoginIdPattern.test(loginId) ||
      typeof password !== "string" ||
      password.length < 12 ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      res.status(400).json({ error: "Invalid partner operator details" });
      return;
    }
    const [merchant] = await db
      .select()
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId));
    if (!merchant || merchant.status !== "active") {
      res.status(404).json({ error: "Active merchant not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.loginId, loginId));
    if (
      existing &&
      (existing.role === "superadmin" ||
        existing.role === "platform_admin" ||
        (existing.merchantId !== null && existing.merchantId !== merchantId))
    ) {
      res
        .status(409)
        .json({ error: "This login ID cannot be assigned to the merchant" });
      return;
    }
    const values = {
      passwordHash: await hashPassword(password),
      name: name.trim(),
      role: "hq",
      permission: "admin",
      merchantId,
      parentId: null,
      isActive: true,
      useOtp: false,
    } as const;
    const [operator] = existing
      ? await db
          .update(adminUsersTable)
          .set(values)
          .where(eq(adminUsersTable.id, existing.id))
          .returning()
      : await db
          .insert(adminUsersTable)
          .values({ loginId, ...values })
          .returning();
    await writeAuditLog(req, {
      actorId: caller.id,
      action: "merchant.partner_operator.upsert",
      resourceType: "merchant",
      resourceId: merchantId,
      metadata: { loginId: operator.loginId, operatorId: operator.id },
    });
    res.json({
      id: operator.id,
      loginId: operator.loginId,
      name: operator.name,
      merchantId: operator.merchantId,
      role: operator.role,
    });
  },
);

export default router;
