import { Router } from "express";
import { db, feeConfigsTable, adminUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateFeeConfigBody, UpdateFeeConfigBody } from "@workspace/api-zod";
import { requireAdmin, isAncestorOf } from "../lib/auth.js";
import { enforceCapability } from "../lib/access-control.js";
import { isUserInScope } from "../lib/organization-scope.js";
import { calculateResidualRate } from "../lib/fee-hierarchy.js";
import { writeAuditLog } from "../lib/audit.js";
import { enforceTotp } from "../lib/otp-protection.js";

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
  min_child_usage_fee_rate: string | null;
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
    minChildUsageFeeRate: r.min_child_usage_fee_rate != null ? Number(r.min_child_usage_fee_rate) : null,
  };
}

async function enrichRowsWithShares(rows: FeeRow[]) {
  if (!rows.some(row => row.role === "store")) return rows.map(mapRow);
  const [users, configs] = await Promise.all([
    db.select({
      id: adminUsersTable.id,
      parentId: adminUsersTable.parentId,
    }).from(adminUsersTable),
    db.select({
      userId: feeConfigsTable.userId,
      usageFeeRate: feeConfigsTable.usageFeeRate,
    }).from(feeConfigsTable),
  ]);
  const userMap = new Map(users.map(user => [user.id, user]));
  const rateMap = new Map(configs.map(config => [
    config.userId,
    Number(config.usageFeeRate),
  ]));

  return rows.map(row => {
    const mapped = mapRow(row);
    if (row.role !== "store" || row.usage_fee_rate == null) return mapped;
    const ancestorRates: number[] = [];
    const visited = new Set<number>();
    let currentId = row.parent_id;
    while (currentId != null && !visited.has(currentId)) {
      visited.add(currentId);
      ancestorRates.push(rateMap.get(currentId) ?? 0);
      currentId = userMap.get(currentId)?.parentId ?? null;
    }
    const result = calculateResidualRate(Number(row.usage_fee_rate), ancestorRates);
    return {
      ...mapped,
      allocatedUsageFeeRate: result.allocatedRate,
      storeShare: result.residualRate,
    };
  });
}

async function validateUsageFeeAllocation(
  userId: number,
  usageFeeRate: number,
  executor: Pick<typeof db, "select"> = db,
): Promise<string | null> {
  const [users, feeConfigs] = await Promise.all([
    executor.select({
      id: adminUsersTable.id,
      name: adminUsersTable.name,
      role: adminUsersTable.role,
      parentId: adminUsersTable.parentId,
    }).from(adminUsersTable),
    executor.select({
      userId: feeConfigsTable.userId,
      usageFeeRate: feeConfigsTable.usageFeeRate,
    }).from(feeConfigsTable),
  ]);

  const userMap = new Map(users.map(user => [user.id, user]));
  const target = userMap.get(userId);
  if (!target) return "수수료를 설정할 계정을 찾을 수 없습니다";

  const rateMap = new Map(feeConfigs.map(config => [
    config.userId,
    Number(config.usageFeeRate),
  ]));
  rateMap.set(userId, usageFeeRate);

  const affectedStores = target.role === "store"
    ? [target]
    : users.filter(user => {
        if (user.role !== "store") return false;
        const visited = new Set<number>();
        let currentId = user.parentId;
        while (currentId != null && !visited.has(currentId)) {
          if (currentId === userId) return true;
          visited.add(currentId);
          currentId = userMap.get(currentId)?.parentId ?? null;
        }
        return false;
      });

  for (const store of affectedStores) {
    const totalRate = rateMap.get(store.id) ?? 0;
    let allocatedRate = 0;
    const visited = new Set<number>();
    let currentId = store.parentId;

    while (currentId != null && !visited.has(currentId)) {
      visited.add(currentId);
      allocatedRate += rateMap.get(currentId) ?? 0;
      currentId = userMap.get(currentId)?.parentId ?? null;
    }

    const roundedAllocatedRate = Math.round(allocatedRate * 100) / 100;
    if (roundedAllocatedRate > totalRate + Number.EPSILON) {
      return `조직 배분 합계(${roundedAllocatedRate}%)가 매장 ${store.name} 이용수수료율(${totalRate}%)을 초과합니다`;
    }
  }

  return null;
}

class FeeAllocationError extends Error {}

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
  pfc.usage_fee_rate AS parent_usage_fee_rate,
  (
    SELECT MIN(cfc.usage_fee_rate)
    FROM admin_users child
    JOIN fee_configs cfc ON cfc.user_id = child.id
    WHERE child.parent_id = au.id
  ) AS min_child_usage_fee_rate
`);

router.get("/fees", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "fees.read", res)) return;

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
        WHERE au.role = ${roleFilter}
        ORDER BY au.name
      `);
      rows = (result as unknown as { rows: FeeRow[] }).rows;
    }

    res.json(await enrichRowsWithShares(rows));
    return;
  }

  const parentId = req.query.parentId
    ? parseInt(req.query.parentId as string, 10)
    : caller.id;
  if (!Number.isInteger(parentId)
    || !(await isUserInScope(caller, parentId, { includeSelf: true }))) {
    res.status(403).json({ error: "해당 조직의 수수료를 조회할 권한이 없습니다" });
    return;
  }

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
  res.json(await enrichRowsWithShares(rows));
});

router.post("/fees", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "fees.manage", res)) return;
  if (!(await enforceTotp(caller, req, res, "sensitive"))) return;

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

  let f: { id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; usage_fee_rate: string; created_at: string };
  try {
    f = await db.transaction(async tx => {
      // All hierarchy fee changes are serialized so two simultaneous updates
      // cannot each validate against a stale allocation and exceed the store cap.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73000, 1)`);
      const usageFeeError = await validateUsageFeeAllocation(
        userId,
        usageFeeRate,
        tx,
      );
      if (usageFeeError) throw new FeeAllocationError(usageFeeError);

      const result = await tx.execute(sql`
        INSERT INTO fee_configs (user_id, deposit_fee, withdrawal_fee, usage_fee_rate)
        VALUES (${userId}, ${depositFee}, ${withdrawalFee}, ${String(usageFeeRate)})
        ON CONFLICT (user_id) DO UPDATE
          SET deposit_fee    = EXCLUDED.deposit_fee,
              withdrawal_fee = EXCLUDED.withdrawal_fee,
              usage_fee_rate = EXCLUDED.usage_fee_rate
        RETURNING id, user_id, deposit_fee, withdrawal_fee, usage_fee_rate, created_at
      `);
      const row = (result as unknown as {
        rows: Array<typeof f>;
      }).rows[0];
      if (!row) throw new Error("FEE_CONFIG_WRITE_FAILED");
      return row;
    });
  } catch (error) {
    if (error instanceof FeeAllocationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }

  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.user_id));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "fee.upsert",
    resourceType: "fee_config",
    resourceId: f.id,
    metadata: {
      userId: f.user_id,
      depositFee: Number(f.deposit_fee),
      withdrawalFee: Number(f.withdrawal_fee),
      usageFeeRate: Number(f.usage_fee_rate),
    },
  });
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
  if (!enforceCapability(caller, "fees.manage", res)) return;
  if (!(await enforceTotp(caller, req, res, "sensitive"))) return;

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

  let f: { id: number; user_id: number; deposit_fee: string; withdrawal_fee: string; usage_fee_rate: string; created_at: string } | undefined;
  try {
    f = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73000, 1)`);
      const usageFeeError = await validateUsageFeeAllocation(
        existingFee.user_id,
        newUsageFeeRate,
        tx,
      );
      if (usageFeeError) throw new FeeAllocationError(usageFeeError);

      const result = await tx.execute(sql`
        UPDATE fee_configs
        SET deposit_fee = ${newDeposit},
            withdrawal_fee = ${newWithdrawal},
            usage_fee_rate = ${String(newUsageFeeRate)}
        WHERE id = ${id}
        RETURNING id, user_id, deposit_fee, withdrawal_fee, usage_fee_rate, created_at
      `);
      return (result as unknown as {
        rows: Array<typeof f>;
      }).rows[0];
    });
  } catch (error) {
    if (error instanceof FeeAllocationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!f) { res.status(404).json({ error: "Not found" }); return; }

  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, f.user_id));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "fee.update",
    resourceType: "fee_config",
    resourceId: f.id,
    metadata: {
      userId: f.user_id,
      depositFee: Number(f.deposit_fee),
      withdrawalFee: Number(f.withdrawal_fee),
      usageFeeRate: Number(f.usage_fee_rate),
    },
  });
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
