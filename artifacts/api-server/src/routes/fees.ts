import { Router } from "express";
import { db, feeConfigsTable, adminUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ListFeesQueryParams, CreateFeeConfigBody, UpdateFeeConfigBody } from "@workspace/api-zod";

const router = Router();

async function formatFee(f: typeof feeConfigsTable.$inferSelect) {
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.userId));
  return {
    id: f.id,
    userId: f.userId,
    userName: user?.name ?? "Unknown",
    role: user?.role ?? "unknown",
    depositFee: Number(f.depositFee),
    withdrawalFee: Number(f.withdrawalFee),
    createdAt: f.createdAt.toISOString(),
  };
}

router.get("/fees", async (req, res) => {
  const parsed = ListFeesQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const conditions = [];
  if (params.userId) conditions.push(eq(feeConfigsTable.userId, params.userId));
  const fees = await db.select().from(feeConfigsTable);
  const formatted = await Promise.all(fees.map(formatFee));
  res.json(formatted);
});

router.post("/fees", async (req, res) => {
  const parsed = CreateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [f] = await db.insert(feeConfigsTable).values({
    userId: parsed.data.userId,
    depositFee: String(parsed.data.depositFee),
    withdrawalFee: String(parsed.data.withdrawalFee),
  }).returning();
  res.status(201).json(await formatFee(f));
});

router.patch("/fees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates: Record<string, string> = {};
  if (parsed.data.depositFee !== undefined) updates.depositFee = String(parsed.data.depositFee);
  if (parsed.data.withdrawalFee !== undefined) updates.withdrawalFee = String(parsed.data.withdrawalFee);
  const [f] = await db.update(feeConfigsTable).set(updates as any).where(eq(feeConfigsTable.id, id)).returning();
  if (!f) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatFee(f));
});

export default router;
