import { Router } from "express";
import { adminUsersTable, db, otpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import {
  encryptMfaSecret,
  generateMfaSecret,
  mfaUri,
  verifyTotpCode,
  verifyUserTotp,
  decryptMfaSecret,
} from "../lib/mfa.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

async function getOrCreateSettings(userId: number) {
  let [settings] = await db.select().from(otpSettingsTable)
    .where(eq(otpSettingsTable.userId, userId));
  if (!settings) {
    [settings] = await db.insert(otpSettingsTable).values({
      userId,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
    }).returning();
  }
  return settings;
}

router.get("/otp/settings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const settings = await getOrCreateSettings(caller.id);
  res.json({
    enabled: caller.useOtp && Boolean(settings.verifiedAt),
    verifiedAt: settings.verifiedAt?.toISOString() ?? null,
    useOtpForDeposit: settings.useOtpForDeposit,
    useOtpForWithdrawal: settings.useOtpForWithdrawal,
    otpSecret: null,
  });
});

router.post("/otp/enroll", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const secret = generateMfaSecret();
  const encrypted = encryptMfaSecret(secret);
  await getOrCreateSettings(caller.id);
  await db.update(otpSettingsTable).set({
    otpSecret: encrypted,
    verifiedAt: null,
    lastUsedStep: null,
    useOtpForWithdrawal: false,
    useOtpForDeposit: false,
  }).where(eq(otpSettingsTable.userId, caller.id));
  await db.update(adminUsersTable).set({ useOtp: false })
    .where(eq(adminUsersTable.id, caller.id));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "mfa.enrollment_started",
    resourceType: "admin_user",
    resourceId: caller.id,
  });
  res.json({ secret, otpauthUri: mfaUri(caller.loginId, secret) });
});

router.post("/otp/verify-enrollment", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const [settings] = await db.select().from(otpSettingsTable)
    .where(eq(otpSettingsTable.userId, caller.id)).limit(1);
  if (!settings?.otpSecret) {
    res.status(409).json({ error: "Start MFA enrollment first" });
    return;
  }
  const step = verifyTotpCode(decryptMfaSecret(settings.otpSecret), code);
  if (step === null) {
    res.status(400).json({ error: "OTP 코드가 올바르지 않습니다." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(otpSettingsTable).set({
      verifiedAt: new Date(),
      lastUsedStep: step,
      useOtpForWithdrawal: true,
    }).where(eq(otpSettingsTable.userId, caller.id));
    await tx.update(adminUsersTable).set({
      useOtp: true,
      sessionVersion: caller.sessionVersion + 1,
    }).where(eq(adminUsersTable.id, caller.id));
  });
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "mfa.enabled",
    resourceType: "admin_user",
    resourceId: caller.id,
  });
  res.json({ success: true, loginAgain: true });
});

router.patch("/otp/settings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!caller.useOtp || !(await verifyUserTotp(caller.id, code))) {
    res.status(403).json({ error: "A valid OTP code is required" });
    return;
  }
  const updates: Partial<typeof otpSettingsTable.$inferInsert> = {};
  if (typeof req.body?.useOtpForDeposit === "boolean") {
    updates.useOtpForDeposit = req.body.useOtpForDeposit;
  }
  if (typeof req.body?.useOtpForWithdrawal === "boolean") {
    updates.useOtpForWithdrawal = req.body.useOtpForWithdrawal;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "변경할 설정이 없습니다." });
    return;
  }
  const [updated] = await db.update(otpSettingsTable).set(updates)
    .where(eq(otpSettingsTable.userId, caller.id)).returning();
  res.json({
    enabled: true,
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
    useOtpForDeposit: updated.useOtpForDeposit,
    useOtpForWithdrawal: updated.useOtpForWithdrawal,
    otpSecret: null,
  });
});

router.post("/otp/disable", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!caller.useOtp || !(await verifyUserTotp(caller.id, code))) {
    res.status(403).json({ error: "A valid OTP code is required" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(otpSettingsTable).set({
      otpSecret: null,
      verifiedAt: null,
      lastUsedStep: null,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
    }).where(eq(otpSettingsTable.userId, caller.id));
    await tx.update(adminUsersTable).set({
      useOtp: false,
      sessionVersion: caller.sessionVersion + 1,
    }).where(eq(adminUsersTable.id, caller.id));
  });
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "mfa.disabled",
    resourceType: "admin_user",
    resourceId: caller.id,
  });
  res.json({ success: true, loginAgain: true });
});

export default router;
