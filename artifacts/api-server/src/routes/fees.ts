import { Router } from "express";
import { db, feeConfigsTable, adminUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateFeeConfigBody, UpdateFeeConfigBody } from "@workspace/api-zod";
import { requireAdmin, isAncestorOf } from "../lib/auth.js";

const router = Router();

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
  usage_fee_rate: string | null;
  parent_deposit_fee: string | null;
  parent_withdrawal_fee: string | null;
  parent_usage_fee_rate: string | null;
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
    usageFeeRate: r.usage_fee_rate != null ? Number(r.usage_fee_rate) : null,
    parentDepositFee: r.parent_deposit_fee != null ? Number(r.parent_deposit_fee) : null,
    parentWithdrawalFee: r.parent_withdrawal_fee != null ? Number(r.parent_withdrawal_fee) : null,
    parentUsageFeeRate: r.parent_usage_fee_rate != null ? Number(r.parent_usage_fee_rate) : null,
  };
}

async function validateUsageFeeRateAgainstParent(
  userId: number,
  usageFeeRate: number,
): Promise<string | null> {
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, userId));
  if (!user || !user.parentId) return null;

  const [parentFee] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, user.parentId));
  if (!parentFee) return null;

  const parentRate = Number(parentFee.usageFeeRate);
  if (usageFeeRate < parentRate) {
    return `이용 수수료율(${usageFeeRate}%)이 상위 계정 이용 수수료율(${parentRate}%)보다 낮을 수 없습니다`;
  }
  return null;
}

async function canManageFee(
  caller: typeof adminUsersTable.$inferSelect,
  targetUserId: number,
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  if (caller.id === targetUserId) return false;
  return isAncestorOf(caller.id, targetUserId);
}

const FEE_SQL_COLUMNS = sql.raw(`
  au.id         AS user_id,
  au.login_id   AS user_login_id,
  au.name       AS user_name,
  au.role       AS role,
  au.parent_id  AS parent_id,
  p.name        AS parent_name,
  p.login_id    AS parent_login_id,
  fc.id              AS fee_config_id,
  fc.deposit_fee     AS deposit_fee,
  fc.withdrawal_fee  AS withdrawal_fee,
  fc.usage_fee_rate  AS usage_fee_rate,
  pfc.deposit_fee    AS parent_deposit_fee,
  pfc.withdrawal_fee AS parent_withdrawal_fee,
  pfc.usage_fee_rate AS parent_usage_fee_rate
`);

router.get("/fees", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const roleFilter = req.query.role as string | undefined;

  if (roleFilter) {
    let rows: FeeRow[];

    if (caller.role === "superadmin") {
      const result = await db.execute(sql`
        SELECT ${FEE_SQL_COLUMNS}
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
        SELECT ${FEE_SQL_COLUMNS}
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

  const parentId = req.query.parentId
    ? parseInt(req.query.parentId as string, 10)
    : caller.id;

  const result = await db.execute(sql`
    SELECT ${FEE_SQL_COLUMNS}
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

router.post("/fees", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { userId, depositFee, withdrawalFee } = parsed.data;
  const usageFeeRate = parsed.data.usageFeeRate ?? 0;

  if (!(await canManageFee(caller, userId))) {
    res.status(403).json({ error: "해당 계정의 수수료를 설정할 권한이 없습니다" }); return;
  }

  if (depositFee < 0 || withdrawalFee < 0) {
    res.status(400).json({ error: "수수료는 0원 이상이어야 합니다" }); return;
  }
  if (usageFeeRate < 0 || usageFeeRate > 100) {
    res.status(400).json({ error: "이용 수수료율은 0~100% 사이여야 합니다" }); return;
  }

  const usageFeeError = await validateUsageFeeRateAgainstParent(userId, usageFeeRate);
  if (usageFeeError) { res.status(400).json({ error: usageFeeError }); return; }

  const [f] = await db.execute(sql`
    INSERT INTO fee_configs (user_id, deposit_fee, withdrawal_fee, usage_fee_rate)
    VALUES (${userId}, ${depositFee}, ${withdrawalFee}, ${String(usageFeeRate)})
    ON CONFLICT (user_id) DO UPDATE
      SET deposit_fee    = EXCLUDED.deposit_fee,
          withdrawal_fee = EXCLUDED.withdrawal_fee,
          usage_fee_rate = EXCLUDED.usage_fee_rate
    RETURNING id, user_id, deposit_fee, withdrawal_fee, usage_fee_rate, created_at
  `).then(r => (r as unknown as { rows: Array<{ id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; usage_fee_rate: string; created_at: string }> }).rows);

  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.user_id));
  res.status(200).json({
    id: f.id,
    userId: f.user_id,
    userName: user?.name ?? "Unknown",
    role: user?.role ?? "unknown",
    depositFee: Number(f.deposit_fee),
    withdrawalFee: Number(f.withdrawal_fee),
    usageFeeRate: Number(f.usage_fee_rate),
    createdAt: f.created_at,
  });
});

router.patch("/fees/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  const parsed = UpdateFeeConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const existing = await db.execute(sql`SELECT id, user_id, deposit_fee, withdrawal_fee, usage_fee_rate FROM fee_configs WHERE id = ${id}`);
  const existingRows = (existing as unknown as { rows: Array<{ id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; usage_fee_rate: string }> }).rows;
  if (existingRows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const existingFee = existingRows[0];

  if (!(await canManageFee(caller, existingFee.user_id))) {
    res.status(403).json({ error: "해당 계정의 수수료를 수정할 권한이 없습니다" }); return;
  }

  const newDeposit = parsed.data.depositFee ?? Number(existingFee.deposit_fee);
  const newWithdrawal = parsed.data.withdrawalFee ?? Number(existingFee.withdrawal_fee);
  const newUsageFeeRate = parsed.data.usageFeeRate ?? Number(existingFee.usage_fee_rate);

  if (newDeposit < 0 || newWithdrawal < 0) {
    res.status(400).json({ error: "수수료는 0원 이상이어야 합니다" }); return;
  }
  if (newUsageFeeRate < 0 || newUsageFeeRate > 100) {
    res.status(400).json({ error: "이용 수수료율은 0~100% 사이여야 합니다" }); return;
  }

  const usageFeeError = await validateUsageFeeRateAgainstParent(existingFee.user_id, newUsageFeeRate);
  if (usageFeeError) { res.status(400).json({ error: usageFeeError }); return; }

  const result = await db.execute(sql`
    UPDATE fee_configs
    SET deposit_fee = ${newDeposit},
        withdrawal_fee = ${newWithdrawal},
        usage_fee_rate = ${String(newUsageFeeRate)}
    WHERE id = ${id}
    RETURNING id, user_id, deposit_fee, withdrawal_fee, usage_fee_rate, created_at
  `);
  const rows = (result as unknown as { rows: Array<{ id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; usage_fee_rate: string; created_at: string }> }).rows;
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
    usageFeeRate: Number(f.usage_fee_rate),
    createdAt: f.created_at,
  });
});

export default router;
