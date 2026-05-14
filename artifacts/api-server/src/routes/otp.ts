import { Router } from "express";
import { db, otpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateOtpSettingsBody } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

async function getOrCreateSettings(userId: number) {
  let [settings] = await db.select().from(otpSettingsTable).where(eq(otpSettingsTable.userId, userId));
  if (!settings) {
    const [created] = await db.insert(otpSettingsTable).values({
      userId,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
    }).returning();
    settings = created;
  }
  return settings;
}

router.get("/otp/settings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const settings = await getOrCreateSettings(caller.id);
  res.json({
    useOtpForDeposit: settings.useOtpForDeposit,
    useOtpForWithdrawal: settings.useOtpForWithdrawal,
    otpSecret: settings.otpSecret ?? null,
  });
});

router.patch("/otp/settings", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = UpdateOtpSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  await getOrCreateSettings(caller.id);

  const updates: Partial<typeof otpSettingsTable.$inferInsert> = {};
  if (parsed.data.useOtpForDeposit !== undefined) updates.useOtpForDeposit = parsed.data.useOtpForDeposit;
  if (parsed.data.useOtpForWithdrawal !== undefined) updates.useOtpForWithdrawal = parsed.data.useOtpForWithdrawal;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "변경할 항목이 없습니다" }); return;
  }

  const [updated] = await db
    .update(otpSettingsTable)
    .set(updates)
    .where(eq(otpSettingsTable.userId, caller.id))
    .returning();

  res.json({
    useOtpForDeposit: updated.useOtpForDeposit,
    useOtpForWithdrawal: updated.useOtpForWithdrawal,
    otpSecret: updated.otpSecret ?? null,
  });
});

export default router;
