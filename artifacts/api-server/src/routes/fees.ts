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
  parent_deposit_fee: string | null;
  parent_withdrawal_fee: string | null;
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
    parentDepositFee: r.parent_deposit_fee != null ? Number(r.parent_deposit_fee) : null,
    parentWithdrawalFee: r.parent_withdrawal_fee != null ? Number(r.parent_withdrawal_fee) : null,
  };
}

// Validate that child fee <= parent fee (cascading constraint)
// Returns error message if invalid, null if OK
async function validateAgainstParent(
  userId: number,
  depositFee: number | undefined,
  withdrawalFee: number | undefined,
): Promise<string | null> {
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, userId));
  if (!user || !user.parentId) return null; // superadmin or HQ with no parent — no cap

  const [parentFee] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, user.parentId));
  if (!parentFee) return null; // parent has no fee configured yet — no cap enforced

  if (depositFee !== undefined && depositFee > Number(parentFee.depositFee)) {
    return `입금 수수료(${depositFee}%)가 상위 계정 수수료(${Number(parentFee.depositFee)}%)를 초과할 수 없습니다`;
  }
  if (withdrawalFee !== undefined && withdrawalFee > Number(parentFee.withdrawalFee)) {
    return `출금 수수료(${withdrawalFee}%)가 상위 계정 수수료(${Number(parentFee.withdrawalFee)}%)를 초과할 수 없습니다`;
  }
  return null;
}

// GET /fees — admin only, returns users at given role with their fee + parent's fee
router.get("/fees", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const roleFilter = req.query.role as string | undefined;

  if (roleFilter) {
    let rows: FeeRow[];

    if (caller.role === "superadmin") {
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
          fc.withdrawal_fee AS withdrawal_fee,
          pfc.deposit_fee    AS parent_deposit_fee,
          pfc.withdrawal_fee AS parent_withdrawal_fee
        FROM admin_users au
        LEFT JOIN admin_users p ON p.id = au.parent_id
        LEFT JOIN fee_configs fc  ON fc.user_id  = au.id
        LEFT JOIN fee_configs pfc ON pfc.user_id = au.parent_id
        WHERE au.role = ${roleFilter}
        ORDER BY au.name
      `);
      rows = (result as unknown as { rows: FeeRow[] }).rows;
    } else {
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
          fc.withdrawal_fee AS withdrawal_fee,
          pfc.deposit_fee    AS parent_deposit_fee,
          pfc.withdrawal_fee AS parent_withdrawal_fee
        FROM descendants au
        LEFT JOIN admin_users p ON p.id = au.parent_id
        LEFT JOIN fee_configs fc  ON fc.user_id  = au.id
        LEFT JOIN fee_configs pfc ON pfc.user_id = au.parent_id
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
      fc.withdrawal_fee AS withdrawal_fee,
      pfc.deposit_fee    AS parent_deposit_fee,
      pfc.withdrawal_fee AS parent_withdrawal_fee
    FROM admin_users au
    LEFT JOIN admin_users p ON p.id = au.parent_id
    LEFT JOIN fee_configs fc  ON fc.user_id  = au.id
    LEFT JOIN fee_configs pfc ON pfc.user_id = au.parent_id
    WHERE au.parent_id = ${parentId}
    ORDER BY au.name
  `);
  const rows = (result as unknown as { rows: FeeRow[] }).rows;
  res.json(rows.map(mapRow));
});

// POST /fees — create or upsert fee config (validates child ≤ parent)
router.post("/fees", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { userId, depositFee, withdrawalFee } = parsed.data;

  // Range check
  if (depositFee < 0 || depositFee > 100 || withdrawalFee < 0 || withdrawalFee > 100) {
    res.status(400).json({ error: "수수료는 0~100% 사이여야 합니다" }); return;
  }

  // Cascade constraint: child fee must not exceed parent fee
  const validationError = await validateAgainstParent(userId, depositFee, withdrawalFee);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const [f] = await db.execute(sql`
    INSERT INTO fee_configs (user_id, deposit_fee, withdrawal_fee)
    VALUES (${userId}, ${String(depositFee)}, ${String(withdrawalFee)})
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

// PATCH /fees/:id — update fee config (validates child ≤ parent)
router.patch("/fees/:id", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  const parsed = UpdateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  // Fetch the existing fee record to get userId
  const existing = await db.execute(sql`SELECT id, user_id, deposit_fee, withdrawal_fee FROM fee_configs WHERE id = ${id}`);
  const existingRows = (existing as unknown as { rows: Array<{ id: number; user_id: number; deposit_fee: string; withdrawal_fee: string }> }).rows;
  if (existingRows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const existingFee = existingRows[0];

  const newDeposit = parsed.data.depositFee !== undefined ? parsed.data.depositFee : Number(existingFee.deposit_fee);
  const newWithdrawal = parsed.data.withdrawalFee !== undefined ? parsed.data.withdrawalFee : Number(existingFee.withdrawal_fee);

  // Range check
  if (newDeposit < 0 || newDeposit > 100 || newWithdrawal < 0 || newWithdrawal > 100) {
    res.status(400).json({ error: "수수료는 0~100% 사이여야 합니다" }); return;
  }

  // Cascade constraint
  const validationError = await validateAgainstParent(existingFee.user_id, newDeposit, newWithdrawal);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

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
