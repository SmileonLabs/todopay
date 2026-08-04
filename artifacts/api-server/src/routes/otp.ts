import { Router } from "express";
import { adminUsersTable, db, otpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateOtpSettingsBody } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";
import { enforceCapability } from "../lib/access-control.js";
import {
  buildOtpAuthUrl,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  verifyTotp,
} from "../lib/totp.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

async function getOrCreateSettings(userId: number) {
  let [settings] = await db.select().from(otpSettingsTable).where(eq(otpSettingsTable.userId, userId));
  if (!settings) {
    [settings] = await db.insert(otpSettingsTable).values({
      userId,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
    }).returning();
  }
  return settings;
}

function activeSecret(settings: typeof otpSettingsTable.$inferSelect): string | null {
  if (!settings.otpSecret || !settings.verifiedAt || !settings.otpSecret.startsWith("v1.")) return null;
  try { return decryptTotpSecret(settings.otpSecret); } catch { return null; }
}

router.get("/otp/settings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "otp.manage", res)) return;
  const settings = await getOrCreateSettings(caller.id);
  res.json({
    useOtpForDeposit: settings.useOtpForDeposit,
    useOtpForWithdrawal: settings.useOtpForWithdrawal,
    enrolled: Boolean(activeSecret(settings)),
    verifiedAt: settings.verifiedAt?.toISOString() ?? null,
    enrollmentPending: Boolean(settings.pendingSecret),
  });
});

router.post("/otp/enrollment", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "otp.manage", res)) return;
  const secret = generateTotpSecret();
  await getOrCreateSettings(caller.id);
  await db.update(otpSettingsTable).set({
    pendingSecret: encryptTotpSecret(secret),
    updatedAt: new Date(),
  }).where(eq(otpSettingsTable.userId, caller.id));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "otp.enrollment_started",
    resourceType: "otp_setting",
    resourceId: caller.id,
  });
  res.status(201).json({
    secret,
    otpAuthUrl: buildOtpAuthUrl(caller.loginId, secret),
  });
});

router.post("/otp/enrollment/verify", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "otp.manage", res)) return;
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const settings = await getOrCreateSettings(caller.id);
  if (!settings.pendingSecret) {
    res.status(409).json({ error: "진행 중인 OTP 등록이 없습니다." }); return;
  }
  let secret: string;
  try { secret = decryptTotpSecret(settings.pendingSecret); } catch {
    res.status(409).json({ error: "OTP 등록 정보를 다시 생성해주세요." }); return;
  }
  if (!verifyTotp(secret, code)) {
    res.status(400).json({ error: "OTP 코드가 일치하지 않습니다." }); return;
  }
  const recoveryCodes = generateRecoveryCodes();
  await db.transaction(async tx => {
    await tx.update(otpSettingsTable).set({
      otpSecret: encryptTotpSecret(secret),
      pendingSecret: null,
      verifiedAt: new Date(),
      recoveryCodesHash: hashRecoveryCodes(recoveryCodes),
      updatedAt: new Date(),
    }).where(eq(otpSettingsTable.userId, caller.id));
    await tx.update(adminUsersTable).set({ useOtp: true })
      .where(eq(adminUsersTable.id, caller.id));
  });
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "otp.enrollment_verified",
    resourceType: "otp_setting",
    resourceId: caller.id,
  });
  res.json({ success: true, recoveryCodes });
});

router.patch("/otp/settings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "otp.manage", res)) return;
  const parsed = UpdateOtpSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const settings = await getOrCreateSettings(caller.id);
  if ((parsed.data.useOtpForDeposit || parsed.data.useOtpForWithdrawal) && !activeSecret(settings)) {
    res.status(409).json({ error: "OTP 앱 등록과 코드 확인을 먼저 완료해주세요." }); return;
  }
  const updates: Partial<typeof otpSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.useOtpForDeposit !== undefined) updates.useOtpForDeposit = parsed.data.useOtpForDeposit;
  if (parsed.data.useOtpForWithdrawal !== undefined) updates.useOtpForWithdrawal = parsed.data.useOtpForWithdrawal;
  if (Object.keys(updates).length === 1) {
    res.status(400).json({ error: "변경할 항목이 없습니다" }); return;
  }
  const [updated] = await db.update(otpSettingsTable).set(updates)
    .where(eq(otpSettingsTable.userId, caller.id)).returning();
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "otp.settings_update",
    resourceType: "otp_setting",
    resourceId: caller.id,
    metadata: {
      useOtpForDeposit: updated.useOtpForDeposit,
      useOtpForWithdrawal: updated.useOtpForWithdrawal,
    },
  });
  res.json({
    useOtpForDeposit: updated.useOtpForDeposit,
    useOtpForWithdrawal: updated.useOtpForWithdrawal,
    enrolled: Boolean(activeSecret(updated)),
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
    enrollmentPending: Boolean(updated.pendingSecret),
  });
});

router.post("/otp/verify", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "otp.manage", res)) return;
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const settings = await getOrCreateSettings(caller.id);
  const secret = activeSecret(settings);
  if (!secret || !verifyTotp(secret, code)) {
    res.status(400).json({ error: "OTP 코드가 일치하지 않습니다." }); return;
  }
  res.json({ valid: true });
});

router.delete("/otp/enrollment", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "otp.manage", res)) return;
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const settings = await getOrCreateSettings(caller.id);
  const secret = activeSecret(settings);
  if (!secret || !verifyTotp(secret, code)) {
    res.status(400).json({ error: "OTP 코드가 일치하지 않습니다." }); return;
  }
  await db.transaction(async tx => {
    await tx.update(otpSettingsTable).set({
      otpSecret: null,
      pendingSecret: null,
      verifiedAt: null,
      recoveryCodesHash: null,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
      updatedAt: new Date(),
    }).where(eq(otpSettingsTable.userId, caller.id));
    await tx.update(adminUsersTable).set({ useOtp: false })
      .where(eq(adminUsersTable.id, caller.id));
  });
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "otp.enrollment_removed",
    resourceType: "otp_setting",
    resourceId: caller.id,
  });
  res.status(204).end();
});

export default router;
