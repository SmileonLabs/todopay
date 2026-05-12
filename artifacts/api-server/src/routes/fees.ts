import { Router } from "express";
import { db, feeConfigsTable, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateFeeConfigBody, UpdateFeeConfigBody } from "@workspace/api-zod";

const router = Router();

async function getCallerFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    if (isNaN(id)) return null;
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
    return user ?? null;
  } catch {
    return null;
  }
}

router.get("/fees", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parentId = req.query.parentId
    ? parseInt(req.query.parentId as string, 10)
    : caller.id;

  const subs = await db
    .select({
      userId: adminUsersTable.id,
      userLoginId: adminUsersTable.loginId,
      userName: adminUsersTable.name,
      role: adminUsersTable.role,
      feeConfigId: feeConfigsTable.id,
      depositFee: feeConfigsTable.depositFee,
      withdrawalFee: feeConfigsTable.withdrawalFee,
    })
    .from(adminUsersTable)
    .leftJoin(feeConfigsTable, eq(feeConfigsTable.userId, adminUsersTable.id))
    .where(eq(adminUsersTable.parentId, parentId));

  const roleOrder = ["hq", "distributor", "agency", "store"];
  subs.sort((a, b) =>
    roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) ||
    a.userName.localeCompare(b.userName, "ko")
  );

  res.json(subs.map(r => ({
    userId: r.userId,
    userLoginId: r.userLoginId,
    userName: r.userName,
    role: r.role,
    feeConfigId: r.feeConfigId ?? null,
    depositFee: r.depositFee != null ? Number(r.depositFee) : null,
    withdrawalFee: r.withdrawalFee != null ? Number(r.withdrawalFee) : null,
  })));
});

router.post("/fees", async (req, res) => {
  const parsed = CreateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [f] = await db.insert(feeConfigsTable).values({
    userId: parsed.data.userId,
    depositFee: String(parsed.data.depositFee),
    withdrawalFee: String(parsed.data.withdrawalFee),
  }).returning();
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.userId));
  res.status(201).json({
    id: f.id,
    userId: f.userId,
    userName: user?.name ?? "Unknown",
    role: user?.role ?? "unknown",
    depositFee: Number(f.depositFee),
    withdrawalFee: Number(f.withdrawalFee),
    createdAt: f.createdAt.toISOString(),
  });
});

router.patch("/fees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates: Record<string, string> = {};
  if (parsed.data.depositFee !== undefined) updates.depositFee = String(parsed.data.depositFee);
  if (parsed.data.withdrawalFee !== undefined) updates.withdrawalFee = String(parsed.data.withdrawalFee);
  const [f] = await db.update(feeConfigsTable).set(updates as never).where(eq(feeConfigsTable.id, id)).returning();
  if (!f) { res.status(404).json({ error: "Not found" }); return; }
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.userId));
  res.json({
    id: f.id,
    userId: f.userId,
    userName: user?.name ?? "Unknown",
    role: user?.role ?? "unknown",
    depositFee: Number(f.depositFee),
    withdrawalFee: Number(f.withdrawalFee),
    createdAt: f.createdAt.toISOString(),
  });
});

export default router;
