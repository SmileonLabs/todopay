import { Router } from "express";
import { db, feeConfigsTable, adminUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
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

  const roleFilter = req.query.role as string | undefined;

  if (roleFilter) {
    // Recursive CTE: get all descendants of caller, filtered by role
    const queryResult = await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id, login_id, name, role, parent_id
        FROM admin_users
        WHERE id = ${caller.id}
        UNION ALL
        SELECT au.id, au.login_id, au.name, au.role, au.parent_id
        FROM admin_users au
        JOIN descendants d ON au.parent_id = d.id
      )
      SELECT
        au.id         AS user_id,
        au.login_id   AS user_login_id,
        au.name       AS user_name,
        au.role       AS role,
        au.parent_id  AS parent_id,
        p.name        AS parent_name,
        p.login_id    AS parent_login_id,
        fc.id         AS fee_config_id,
        fc.deposit_fee    AS deposit_fee,
        fc.withdrawal_fee AS withdrawal_fee
      FROM descendants au
      LEFT JOIN admin_users p ON p.id = au.parent_id
      LEFT JOIN fee_configs fc ON fc.user_id = au.id
      WHERE au.id != ${caller.id}
        AND au.role = ${roleFilter}
      ORDER BY au.name
    `);

    const rows = (queryResult as unknown as { rows: Array<{
      user_id: number;
      user_login_id: string;
      user_name: string;
      role: string;
      parent_id: number | null;
      parent_name: string | null;
      parent_login_id: string | null;
      fee_config_id: number | null;
      deposit_fee: string | null;
      withdrawal_fee: string | null;
    }> }).rows;

    const result = rows.map(r => ({
      userId: r.user_id,
      userLoginId: r.user_login_id,
      userName: r.user_name,
      role: r.role,
      parentId: r.parent_id ?? null,
      parentName: r.parent_name ?? null,
      parentLoginId: r.parent_login_id ?? null,
      feeConfigId: r.fee_config_id ?? null,
      depositFee: r.deposit_fee != null ? Number(r.deposit_fee) : null,
      withdrawalFee: r.withdrawal_fee != null ? Number(r.withdrawal_fee) : null,
    }));

    res.json(result);
    return;
  }

  // Legacy: direct children of parentId (or caller)
  const parentId = req.query.parentId
    ? parseInt(req.query.parentId as string, 10)
    : caller.id;

  const subs = await db
    .select({
      userId: adminUsersTable.id,
      userLoginId: adminUsersTable.loginId,
      userName: adminUsersTable.name,
      role: adminUsersTable.role,
      parentId: adminUsersTable.parentId,
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
    parentId: r.parentId ?? null,
    parentName: null,
    parentLoginId: null,
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
