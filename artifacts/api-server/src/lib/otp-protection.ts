import type { Request, Response } from "express";
import { db, otpSettingsTable, type AdminUser } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptTotpSecret, verifyTotp } from "./totp.js";

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
    valid = verifyTotp(decryptTotpSecret(settings.otpSecret), code);
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
