import { Router } from "express";
import { db, withdrawalsTable, membersTable, adminUsersTable, feeConfigsTable, balanceRecordsTable, storeBalancesTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte, inArray } from "drizzle-orm";
import { ListWithdrawalsQueryParams, CreateWithdrawalBody, RejectWithdrawalBody } from "@workspace/api-zod";
import crypto from "crypto";
import { requireAdmin } from "../lib/auth.js";
import { getAccessibleStoreIds, getMemberIdsForStores } from "../lib/query-utils.js";
import { requireLegacyFinancialWrites } from "../lib/integration-gate.js";
import { enforceCapability } from "../lib/access-control.js";
import { enforceTotp } from "../lib/otp-protection.js";

const router = Router();

function getTomorrow10amKST(): Date {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const nowKST = new Date(Date.now() + KST_OFFSET);
  const tomorrowKST = new Date(nowKST);
  tomorrowKST.setDate(tomorrowKST.getDate() + 1);
  tomorrowKST.setHours(10, 0, 0, 0);
  return new Date(tomorrowKST.getTime() - KST_OFFSET);
}

type WithdrawalRow = typeof withdrawalsTable.$inferSelect;
type AdminUser = typeof adminUsersTable.$inferSelect;

async function getWithdrawalScope(caller: AdminUser) {
  const storeIds = await getAccessibleStoreIds(caller);
  if (storeIds === null) return undefined;
  if (storeIds.length === 0) return sql`false`;
  const memberIds = await getMemberIdsForStores(storeIds);
  return memberIds && memberIds.length > 0
    ? or(inArray(withdrawalsTable.storeId, storeIds), inArray(withdrawalsTable.memberId, memberIds))
    : inArray(withdrawalsTable.storeId, storeIds);
}

async function canAccessWithdrawal(caller: AdminUser, withdrawal: WithdrawalRow): Promise<boolean> {
  const storeIds = await getAccessibleStoreIds(caller);
  if (storeIds === null) return true;
  if (withdrawal.storeId) return storeIds.includes(withdrawal.storeId);
  if (!withdrawal.memberId) return false;
  const [member] = await db.select({ storeId: membersTable.storeId })
    .from(membersTable)
    .where(eq(membersTable.id, withdrawal.memberId));
  return Boolean(member?.storeId && storeIds.includes(member.storeId));
}

function formatWithdrawalRow(
  w: WithdrawalRow,
  memberName: string | null,
  storeName: string | null,
) {
  return {
    id: w.id,
    trackingNumber: w.trackingNumber,
    amount: Number(w.amount),
    fee: Number(w.fee),
    totalAmount: Number(w.totalAmount),
    approvalStatus: w.approvalStatus,
    withdrawalStatus: w.withdrawalStatus,
    accountNumber: w.accountNumber,
    accountBank: w.accountBank,
    accountHolder: w.accountHolder,
    rejectReason: w.rejectReason ?? null,
    memberName,
    storeName,
    storeId: w.storeId ?? null,
    availableAt: w.availableAt ? w.availableAt.toISOString() : null,
    createdAt: w.createdAt.toISOString(),
  };
}

/** Formats a single withdrawal with DB lookups (used for single-item endpoints). */
async function formatWithdrawal(w: WithdrawalRow) {
  let memberName: string | null = null;
  let storeName: string | null = null;
  if (w.storeId) {
    const [store] = await db.select({ name: adminUsersTable.name }).from(adminUsersTable).where(eq(adminUsersTable.id, w.storeId));
    storeName = store?.name ?? null;
  } else if (w.memberId) {
    const [m] = await db.select({ name: membersTable.name, storeId: membersTable.storeId }).from(membersTable).where(eq(membersTable.id, w.memberId));
    memberName = m?.name ?? null;
    if (m?.storeId) {
      const [store] = await db.select({ name: adminUsersTable.name }).from(adminUsersTable).where(eq(adminUsersTable.id, m.storeId));
      storeName = store?.name ?? null;
    }
  }
  return formatWithdrawalRow(w, memberName, storeName);
}

/** Batch-formats multiple withdrawals, loading names in 2–3 queries instead of 2×N. */
async function formatWithdrawalBatch(withdrawals: WithdrawalRow[]) {
  if (withdrawals.length === 0) return [];

  const storeIdsNeeded = [...new Set(withdrawals.filter(w => w.storeId).map(w => w.storeId!))];
  const memberIdsNeeded = [...new Set(withdrawals.filter(w => !w.storeId && w.memberId).map(w => w.memberId!))];

  const emptyStores: { id: number; name: string }[] = [];
  const emptyMembers: { id: number; name: string; storeId: number | null }[] = [];
  const [storeRows, memberRows] = await Promise.all([
    storeIdsNeeded.length > 0
      ? db.select({ id: adminUsersTable.id, name: adminUsersTable.name })
          .from(adminUsersTable).where(inArray(adminUsersTable.id, storeIdsNeeded))
      : Promise.resolve(emptyStores),
    memberIdsNeeded.length > 0
      ? db.select({ id: membersTable.id, name: membersTable.name, storeId: membersTable.storeId })
          .from(membersTable).where(inArray(membersTable.id, memberIdsNeeded))
      : Promise.resolve(emptyMembers),
  ]);

  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]));
  const memberMap = new Map(memberRows.map(m => [m.id, m]));

  // Load store names for any member-linked stores not already fetched
  const memberStoreIds = [...new Set(
    memberRows.filter(m => m.storeId && !storeNameMap.has(m.storeId!)).map(m => m.storeId!)
  )];
  if (memberStoreIds.length > 0) {
    const extraStores = await db.select({ id: adminUsersTable.id, name: adminUsersTable.name })
      .from(adminUsersTable).where(inArray(adminUsersTable.id, memberStoreIds));
    for (const s of extraStores) storeNameMap.set(s.id, s.name);
  }

  return withdrawals.map(w => {
    let memberName: string | null = null;
    let storeName: string | null = null;
    if (w.storeId) {
      storeName = storeNameMap.get(w.storeId) ?? null;
    } else if (w.memberId) {
      const m = memberMap.get(w.memberId);
      memberName = m?.name ?? null;
      if (m?.storeId) storeName = storeNameMap.get(m.storeId) ?? null;
    }
    return formatWithdrawalRow(w, memberName, storeName);
  });
}

router.get("/withdrawals/summary", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.read", res)) return;
  const scope = await getWithdrawalScope(caller);

  const [pending] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<number>`coalesce(sum(total_amount), 0)`,
  }).from(withdrawalsTable).where(scope
    ? and(scope, eq(withdrawalsTable.approvalStatus, "pending"))
    : eq(withdrawalsTable.approvalStatus, "pending"));
  const [approved] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<number>`coalesce(sum(total_amount), 0)`,
  }).from(withdrawalsTable).where(scope
    ? and(scope, eq(withdrawalsTable.approvalStatus, "approved"))
    : eq(withdrawalsTable.approvalStatus, "approved"));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayRow] = await db.select({
    amount: sql<number>`coalesce(sum(amount), 0)`,
  }).from(withdrawalsTable).where(and(
    scope,
    eq(withdrawalsTable.withdrawalStatus, "paid"),
    gte(withdrawalsTable.createdAt, today),
  ));
  res.json({
    pendingCount: Number(pending.count),
    pendingAmount: Number(pending.amount),
    approvedCount: Number(approved.count),
    approvedAmount: Number(approved.amount),
    todayWithdrawn: Number(todayRow.amount),
  });
});

router.get("/withdrawals", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.read", res)) return;

  const parsed = ListWithdrawalsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  const scope = await getWithdrawalScope(caller);
  if (scope) conditions.push(scope);
  if (params.approvalStatus) conditions.push(eq(withdrawalsTable.approvalStatus, params.approvalStatus));
  if (params.withdrawalStatus) conditions.push(eq(withdrawalsTable.withdrawalStatus, params.withdrawalStatus));
  if (params.startDate) conditions.push(gte(withdrawalsTable.createdAt, new Date(params.startDate)));
  if (params.endDate) conditions.push(lte(withdrawalsTable.createdAt, new Date(params.endDate)));
  if (params.search) {
    conditions.push(or(
      ilike(withdrawalsTable.trackingNumber, `%${params.search}%`),
      ilike(withdrawalsTable.accountNumber, `%${params.search}%`),
      ilike(withdrawalsTable.accountHolder, `%${params.search}%`)
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [withdrawals, [{ count }], [totals]] = await Promise.all([
    db.select().from(withdrawalsTable).where(where).limit(limit).offset(offset).orderBy(sql`created_at desc`),
    db.select({ count: sql<number>`count(*)` }).from(withdrawalsTable).where(where),
    db.select({
      totalAmount: sql<number>`coalesce(sum(amount), 0)`,
      totalFee: sql<number>`coalesce(sum(fee), 0)`,
    }).from(withdrawalsTable).where(where),
  ]);

  const formatted = await formatWithdrawalBatch(withdrawals);
  res.json({
    items: formatted,
    total: Number(count),
    totalAmount: Number(totals.totalAmount),
    totalFee: Number(totals.totalFee),
  });
});

router.get("/store/:id/balance", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "financial.read", res)) return;

  const storeId = parseInt(req.params.id, 10);
  const accessibleStoreIds = await getAccessibleStoreIds(caller);
  if (Number.isInteger(storeId) && accessibleStoreIds !== null && !accessibleStoreIds.includes(storeId)) {
    res.status(403).json({ error: "권한이 없습니다." });
    return;
  }
  if (isNaN(storeId)) { res.status(400).json({ error: "잘못된 매장 ID" }); return; }

  const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, storeId));
  if (!store || store.role !== "store") { res.status(404).json({ error: "매장을 찾을 수 없습니다" }); return; }

  const [sb] = await db.select().from(storeBalancesTable).where(eq(storeBalancesTable.storeId, storeId));
  res.json({ storeId, balance: sb ? Number(sb.balance) : 0 });
});

router.post("/withdrawals", async (req, res) => {
  if (!requireLegacyFinancialWrites(res)) return;
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "withdrawals.request", res)) return;

  if (caller.role !== "store") {
    res.status(403).json({ error: "출금 신청은 매장 계정만 가능합니다" }); return;
  }

  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { amount, accountNumber, accountBank, accountHolder } = parsed.data;

  const storeId = caller.id;

  const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, storeId));
  if (!store || store.role !== "store") {
    res.status(400).json({ error: "유효하지 않은 매장입니다" }); return;
  }

  let withdrawalFixedFee = 0;
  const [feeConfig] = await db.select().from(feeConfigsTable).where(eq(feeConfigsTable.userId, storeId));
  if (feeConfig) withdrawalFixedFee = Number(feeConfig.withdrawalFee);

  const fee = withdrawalFixedFee;
  const totalAmount = Number(amount) - fee;
  if (totalAmount <= 0) {
    res.status(400).json({ error: "출금 수수료보다 출금액이 커야 합니다" }); return;
  }

  const availableAt = getTomorrow10amKST();
  const trackingNumber = crypto.randomUUID().replace(/-/g, "").substring(0, 16).toUpperCase();

  let newWithdrawal: WithdrawalRow | null = null;

  try {
    await db.transaction(async (dbtx) => {
      const deductResult = await dbtx.execute(
        sql`UPDATE store_balances
            SET balance    = balance - ${Number(amount)},
                updated_at = NOW()
            WHERE store_id = ${storeId} AND balance >= ${Number(amount)}
            RETURNING id`
      );
      if (!deductResult.rows || deductResult.rows.length === 0) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const [w] = await dbtx.insert(withdrawalsTable).values({
        trackingNumber,
        amount: String(amount),
        fee: String(fee),
        totalAmount: String(totalAmount),
        approvalStatus: "pending",
        withdrawalStatus: "unpaid",
        accountNumber,
        accountBank,
        accountHolder,
        storeId,
        availableAt,
      }).returning();

      newWithdrawal = w;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_BALANCE") {
      const [sb] = await db.select().from(storeBalancesTable).where(eq(storeBalancesTable.storeId, storeId));
      const currentBal = sb ? Number(sb.balance) : 0;
      res.status(400).json({ error: `잔액이 부족합니다 (현재 잔액: ${currentBal.toLocaleString("ko-KR")}원)` });
      return;
    }
    throw err;
  }

  if (!newWithdrawal) {
    res.status(500).json({ error: "출금 신청 처리 중 오류가 발생했습니다" }); return;
  }

  res.status(201).json(await formatWithdrawal(newWithdrawal));
});

router.post("/withdrawals/:id/approve", async (req, res) => {
  if (!requireLegacyFinancialWrites(res)) return;
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "withdrawals.approve", res)) return;
  if (!(await enforceTotp(caller, req, res, "withdrawal"))) return;
  if (caller.role === "store") {
    res.status(403).json({ error: "출금 승인 권한이 없습니다." });
    return;
  }

  const id = parseInt(req.params.id, 10);

  const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessWithdrawal(caller, existing))) {
    res.status(403).json({ error: "권한이 없습니다." });
    return;
  }

  if (existing.availableAt && new Date() < existing.availableAt) {
    const kstTime = new Date(existing.availableAt.getTime() + 9 * 60 * 60 * 1000);
    const formatted = kstTime.toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
    });
    res.status(400).json({ error: `아직 출금 가능 시간이 아닙니다. ${formatted} 이후에 승인 가능합니다` }); return;
  }

  let updated: WithdrawalRow | null = null;

  await db.transaction(async (dbtx) => {
    const [u] = await dbtx.update(withdrawalsTable)
      .set({ approvalStatus: "approved" })
      .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.approvalStatus, "pending")))
      .returning();

    if (!u) throw new Error("ALREADY_PROCESSED");

    await dbtx.insert(balanceRecordsTable).values({
      direction: "out",
      category: "withdrawal",
      amount: u.amount,
      balance: "0",
      description: `출금 승인 - ${u.trackingNumber} (실지급 ${Number(u.totalAmount).toLocaleString("ko-KR")}원)`,
      userId: u.storeId ?? null,
    });

    updated = u;
  });

  if (!updated) {
    res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
  }

  res.json(await formatWithdrawal(updated));
});

router.post("/withdrawals/:id/reject", async (req, res) => {
  if (!requireLegacyFinancialWrites(res)) return;
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "withdrawals.approve", res)) return;
  if (!(await enforceTotp(caller, req, res, "withdrawal"))) return;
  if (caller.role === "store") {
    res.status(403).json({ error: "출금 반려 권한이 없습니다." });
    return;
  }

  const id = parseInt(req.params.id, 10);
  const parsed = RejectWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessWithdrawal(caller, existing))) {
    res.status(403).json({ error: "권한이 없습니다." });
    return;
  }

  let rejected: WithdrawalRow | null = null;

  try {
    await db.transaction(async (dbtx) => {
      const [r] = await dbtx.update(withdrawalsTable)
        .set({ approvalStatus: "rejected", rejectReason: parsed.data.reason })
        .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.approvalStatus, "pending")))
        .returning();

      if (!r) throw new Error("ALREADY_PROCESSED");

      if (r.storeId) {
        await dbtx.execute(sql`
          UPDATE store_balances
          SET balance    = balance + ${Number(r.amount)},
              updated_at = NOW()
          WHERE store_id = ${r.storeId}
        `);

        await dbtx.insert(balanceRecordsTable).values({
          direction: "in",
          category: "refund",
          amount: r.amount,
          balance: "0",
          description: `출금 반려 복원 - ${r.trackingNumber} (사유: ${parsed.data.reason})`,
          userId: r.storeId,
        });
      }

      rejected = r;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_PROCESSED") {
      const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
      if (!existing) { res.status(404).json({ error: "Not found" }); return; }
      res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
    }
    throw err;
  }

  if (!rejected) {
    res.status(500).json({ error: "처리 중 오류가 발생했습니다" }); return;
  }

  res.json(await formatWithdrawal(rejected));
});

export default router;
