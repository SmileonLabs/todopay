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

type FeeRow = {
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
};

function mapRow(r: FeeRow) {
  return {
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
  };
}

router.get("/fees", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const roleFilter = req.query.role as string | undefined;

  if (roleFilter) {
    let rows: FeeRow[];

    if (caller.role === "superadmin") {
      // Superadmin: all users of the requested role (no tree constraint)
      const result = await db.execute(sql`
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
        FROM admin_users au
        LEFT JOIN admin_users p ON p.id = au.parent_id
        LEFT JOIN fee_configs fc ON fc.user_id = au.id
        WHERE au.role = ${roleFilter}
        ORDER BY au.name
      `);
      rows = (result as unknown as { rows: FeeRow[] }).rows;
    } else {
      // Other roles: recursive CTE — only show descendants
      const result = await db.execute(sql`
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
      rows = (result as unknown as { rows: FeeRow[] }).rows;
    }

    res.json(rows.map(mapRow));
    return;
  }

  // Legacy: direct children
  const parentId = req.query.parentId
    ? parseInt(req.query.parentId as string, 10)
    : caller.id;

  const result = await db.execute(sql`
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
    FROM admin_users au
    LEFT JOIN admin_users p ON p.id = au.parent_id
    LEFT JOIN fee_configs fc ON fc.user_id = au.id
    WHERE au.parent_id = ${parentId}
    ORDER BY au.name
  `);
  const rows = (result as unknown as { rows: FeeRow[] }).rows;
  res.json(rows.map(mapRow));
});

router.post("/fees", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  // Upsert: if fee_config already exists for this userId, update instead of insert
  const [f] = await db.execute(sql`
    INSERT INTO fee_configs (user_id, deposit_fee, withdrawal_fee)
    VALUES (${parsed.data.userId}, ${String(parsed.data.depositFee)}, ${String(parsed.data.withdrawalFee)})
    ON CONFLICT (user_id) DO UPDATE
      SET deposit_fee = EXCLUDED.deposit_fee,
          withdrawal_fee = EXCLUDED.withdrawal_fee
    RETURNING id, user_id, deposit_fee, withdrawal_fee, created_at
  `).then(r => (r as unknown as { rows: Array<{ id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; created_at: string }> }).rows);

  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.user_id));
  res.status(200).json({
    id: f.id,
    userId: f.user_id,
    userName: user?.name ?? "Unknown",
    role: user?.role ?? "unknown",
    depositFee: Number(f.deposit_fee),
    withdrawalFee: Number(f.withdrawal_fee),
    createdAt: f.created_at,
  });
});

router.patch("/fees/:id", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  const parsed = UpdateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const updates: Record<string, string> = {};
  if (parsed.data.depositFee !== undefined) updates.deposit_fee = String(parsed.data.depositFee);
  if (parsed.data.withdrawalFee !== undefined) updates.withdrawal_fee = String(parsed.data.withdrawalFee);

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const setClauses = Object.entries(updates)
    .map(([col, val]) => sql`${sql.raw(col)} = ${val}`)
    .reduce((acc, clause, i) => i === 0 ? clause : sql`${acc}, ${clause}`);

  const result = await db.execute(sql`
    UPDATE fee_configs SET ${setClauses} WHERE id = ${id}
    RETURNING id, user_id, deposit_fee, withdrawal_fee, created_at
  `);
  const rows = (result as unknown as { rows: Array<{ id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; created_at: string }> }).rows;
  const f = rows[0];
  if (!f) { res.status(404).json({ error: "Not found" }); return; }

  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.user_id));
  res.json({
    id: f.id,
    userId: f.user_id,
    userName: user?.name ?? "Unknown",
    role: user?.role ?? "unknown",
    depositFee: Number(f.deposit_fee),
    withdrawalFee: Number(f.withdrawal_fee),
    createdAt: f.created_at,
  });
});

export default router;
