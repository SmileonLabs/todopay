import type { Request, Response } from "express";
import crypto from "node:crypto";
import { db, otpSettingsTable, type AdminUser } from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { decryptTotpSecret, matchingTotpStep, recoveryCodeHash } from "./totp.js";

export async function consumeTotp(
  settings: typeof otpSettingsTable.$inferSelect,
  code: string,
): Promise<boolean> {
  if (!settings.otpSecret || !settings.verifiedAt || !settings.otpSecret.startsWith("v1.")) {
    return false;
  }
  if (/^[A-Fa-f0-9]{5}-?[A-Fa-f0-9]{5}$/.test(code) && settings.recoveryCodesHash) {
    let hashes: string[];
    try {
      const parsed = JSON.parse(settings.recoveryCodesHash) as unknown;
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === "string")) return false;
      hashes = parsed;
    } catch {
      return false;
    }
    const suppliedHash = recoveryCodeHash(code);
    const matchIndex = hashes.findIndex(hash => {
      const actual = Buffer.from(suppliedHash, "hex");
      const expected = Buffer.from(hash, "hex");
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    });
    if (matchIndex < 0) return false;
    const remaining = hashes.filter((_, index) => index !== matchIndex);
    const [consumed] = await db.update(otpSettingsTable)
      .set({ recoveryCodesHash: JSON.stringify(remaining), updatedAt: new Date() })
      .where(and(
        eq(otpSettingsTable.userId, settings.userId),
        eq(otpSettingsTable.recoveryCodesHash, settings.recoveryCodesHash),
      ))
      .returning({ id: otpSettingsTable.id });
    return Boolean(consumed);
  }
  const step = matchingTotpStep(decryptTotpSecret(settings.otpSecret), code);
  if (step === null) return false;
  const [consumed] = await db.update(otpSettingsTable)
    .set({ lastUsedStep: step, updatedAt: new Date() })
    .where(and(
      eq(otpSettingsTable.userId, settings.userId),
      or(isNull(otpSettingsTable.lastUsedStep), lt(otpSettingsTable.lastUsedStep, step)),
    ))
    .returning({ id: otpSettingsTable.id });
  return Boolean(consumed);
}

export async function enforceTotp(
  caller: Pick<AdminUser, "id" | "useOtp">,
  req: Request,
  res: Response,
  mode: "sensitive" | "withdrawal",
): Promise<boolean> {
  if (!caller.useOtp) return true;
  const [settings] = await db.select().from(otpSettingsTable)
    .where(eq(otpSettingsTable.userId, caller.id)).limit(1);
  const required = mode === "sensitive" || Boolean(settings?.useOtpForWithdrawal);
  if (!required) return true;
  if (!settings?.otpSecret || !settings.verifiedAt || !settings.otpSecret.startsWith("v1.")) {
    res.status(409).json({
      error: "OTP 보호가 활성화되어 있지만 등록된 OTP가 없습니다.",
      code: "OTP_ENROLLMENT_REQUIRED",
    });
    return false;
  }
  const code = req.get("X-TOTP-Code")?.trim() ?? "";
  let valid = false;
  try {
    valid = await consumeTotp(settings, code);
  } catch {
    valid = false;
  }
  if (!valid) {
    res.status(403).json({
      error: "유효한 OTP 코드가 필요합니다.",
      code: "TOTP_REQUIRED",
    });
    return false;
  }
  return true;
}
