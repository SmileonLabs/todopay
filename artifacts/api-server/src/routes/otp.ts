import { Router } from "express";
import { db, otpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateOtpSettingsBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_USER_ID = 1;

router.get("/otp/settings", async (_req, res) => {
  let [settings] = await db.select().from(otpSettingsTable).where(eq(otpSettingsTable.userId, DEFAULT_USER_ID));
  if (!settings) {
    const [created] = await db.insert(otpSettingsTable).values({
      userId: DEFAULT_USER_ID,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
    }).returning();
    settings = created;
  }
  res.json({
    useOtpForDeposit: settings.useOtpForDeposit,
    useOtpForWithdrawal: settings.useOtpForWithdrawal,
    otpSecret: settings.otpSecret ?? null,
  });
});

router.patch("/otp/settings", async (req, res) => {
  const parsed = UpdateOtpSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  let [existing] = await db.select().from(otpSettingsTable).where(eq(otpSettingsTable.userId, DEFAULT_USER_ID));
  if (!existing) {
    const [created] = await db.insert(otpSettingsTable).values({
      userId: DEFAULT_USER_ID,
      useOtpForDeposit: false,
      useOtpForWithdrawal: false,
    }).returning();
    existing = created;
  }

  const updates: Partial<typeof otpSettingsTable.$inferInsert> = {};
  if (parsed.data.useOtpForDeposit !== undefined) updates.useOtpForDeposit = parsed.data.useOtpForDeposit;
  if (parsed.data.useOtpForWithdrawal !== undefined) updates.useOtpForWithdrawal = parsed.data.useOtpForWithdrawal;

  const [updated] = await db.update(otpSettingsTable).set(updates).where(eq(otpSettingsTable.userId, DEFAULT_USER_ID)).returning();
  res.json({
    useOtpForDeposit: updated.useOtpForDeposit,
    useOtpForWithdrawal: updated.useOtpForWithdrawal,
    otpSecret: updated.otpSecret ?? null,
  });
});

export default router;
