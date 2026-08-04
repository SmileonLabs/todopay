import { Router } from "express";
import { db, withdrawalsTable, membersTable, adminUsersTable, feeConfigsTable, balanceRecordsTable, moneyLedgerTable, storeBalancesTable } from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte, inArray } from "drizzle-orm";
import { ListWithdrawalsQueryParams, CreateWithdrawalBody, RejectWithdrawalBody } from "@workspace/api-zod";
import crypto from "crypto";
import { canAccessMerchant, canActOn, canManageFinance, requireAdmin } from "../lib/auth.js";
import { getAccessibleStoreIds } from "../lib/query-utils.js";
import { writeAuditLog } from "../lib/audit.js";
import { allowRequest } from "../lib/rate-limit.js";
import { requireKrwAmount } from "../lib/money.js";
import { verifyUserTotp } from "../lib/mfa.js";

const router = Router();
const payoutBankCodes: Record<string, string> = {
  "국민은행": "004", "신한은행": "088", "우리은행": "020", "하나은행": "081", "기업은행": "003",
  "농협은행": "011", "카카오뱅크": "090", "토스뱅크": "092", "SC제일은행": "023", "씨티은행": "027",
  "대구은행": "031", "부산은행": "032", "경남은행": "039", "전북은행": "037", "광주은행": "034", "제주은행": "035",
};

function getTomorrow10amKST(): Date {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const nowKST = new Date(Date.now() + KST_OFFSET);
  const tomorrowKST = new Date(nowKST);
  tomorrowKST.setDate(tomorrowKST.getDate() + 1);
  tomorrowKST.setHours(10, 0, 0, 0);
  return new Date(tomorrowKST.getTime() - KST_OFFSET);
}

type WithdrawalRow = typeof withdrawalsTable.$inferSelect;

async function requireWithdrawalMfa(
  req: import("express").Request,
  res: import("express").Response,
  caller: typeof adminUsersTable.$inferSelect,
): Promise<boolean> {
  if (process.env.REQUIRE_FINANCE_MFA !== "true") return true;
  if (!caller.useOtp) {
    res.status(428).json({
      error: "출금 승인을 위해 관리자 OTP 등록이 필요합니다.",
      mfaEnrollmentRequired: true,
    });
    return false;
  }
  const code = req.header("X-TodoPay-OTP") ?? "";
  if (!(await verifyUserTotp(caller.id, code))) {
    res.status(403).json({ error: "유효한 OTP 코드가 필요합니다.", otpRequired: true });
    return false;
  }
  return true;
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
  const accessibleStoreIds = await getAccessibleStoreIds(caller);
  if (accessibleStoreIds !== null && accessibleStoreIds.length === 0) {
    res.json({ pendingCount: 0, pendingAmount: 0, approvedCount: 0, approvedAmount: 0, todayWithdrawn: 0 }); return;
  }
  const scope = accessibleStoreIds === null ? undefined : inArray(withdrawalsTable.storeId, accessibleStoreIds);

  const [pending] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<number>`coalesce(sum(total_amount), 0)`,
  }).from(withdrawalsTable).where(scope ? and(scope, eq(withdrawalsTable.approvalStatus, "pending")) : eq(withdrawalsTable.approvalStatus, "pending"));
  const [approved] = await db.select({
    count: sql<number>`count(*)`,
    amount: sql<number>`coalesce(sum(total_amount), 0)`,
  }).from(withdrawalsTable).where(scope ? and(scope, eq(withdrawalsTable.approvalStatus, "approved")) : eq(withdrawalsTable.approvalStatus, "approved"));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayRow] = await db.select({
    amount: sql<number>`coalesce(sum(amount), 0)`,
  }).from(withdrawalsTable).where(scope ? and(scope, eq(withdrawalsTable.withdrawalStatus, "paid"), gte(withdrawalsTable.createdAt, today)) : and(
    eq(withdrawalsTable.withdrawalStatus, "paid"), gte(withdrawalsTable.createdAt, today)
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

  const parsed = ListWithdrawalsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (caller.merchantId) conditions.push(eq(withdrawalsTable.merchantId, caller.merchantId));
  const accessibleStoreIds = await getAccessibleStoreIds(caller);
  if (accessibleStoreIds !== null) {
    if (accessibleStoreIds.length === 0) { res.json({ items: [], total: 0, totalAmount: 0, totalFee: 0 }); return; }
    conditions.push(inArray(withdrawalsTable.storeId, accessibleStoreIds));
  }
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

  const storeId = parseInt(req.params.id, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "잘못된 매장 ID" }); return; }

  const [store] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, storeId));
  if (!store || store.role !== "store") { res.status(404).json({ error: "매장을 찾을 수 없습니다" }); return; }
  if (!(await canActOn(caller, storeId))) { res.status(403).json({ error: "Forbidden" }); return; }

  const [sb] = await db.select().from(storeBalancesTable).where(eq(storeBalancesTable.storeId, storeId));
  res.json({ storeId, balance: sb ? Number(sb.balance) : 0 });
});

router.post("/withdrawals", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (caller.role !== "store" || caller.permission === "readonly") {
    res.status(403).json({ error: "출금 신청은 매장 계정만 가능합니다" }); return;
  }
  if (!caller.merchantId) {
    res.status(403).json({ error: "Merchant assignment is required" }); return;
  }
  // A rate-limited request must be rejected before it can reserve a balance.
  if (!(await allowRequest("withdrawal-request", `${req.ip ?? "unknown"}:${caller.id}`, { limit: 5, windowSeconds: 60 }))) {
    res.status(429).json({ error: "Too many withdrawal requests" }); return;
  }

  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { amount, accountNumber, accountBank, accountHolder } = parsed.data;
  try {
    requireKrwAmount(amount);
  } catch {
    res.status(400).json({ error: "Withdrawal amount must be a positive KRW integer" }); return;
  }

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
        merchantId: caller.merchantId,
        availableAt,
      }).returning();

      await dbtx.insert(moneyLedgerTable).values({
        storeId,
        merchantId: caller.merchantId,
        direction: "debit",
        amount: String(amount),
        entryType: "withdrawal_reserve",
        referenceType: "withdrawal",
        referenceId: w.id,
      });

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
  const created = newWithdrawal as WithdrawalRow;
  await writeAuditLog(req, { actorId: caller.id, action: "withdrawal.request", resourceType: "withdrawal", resourceId: created.id, metadata: { amount: Number(amount), storeId } });
  res.status(201).json(await formatWithdrawal(created));
});

router.post("/withdrawals/:id/approve", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);

  const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.merchantId && !canAccessMerchant(caller, existing.merchantId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!canManageFinance(caller) || !existing.storeId || !(await canActOn(caller, existing.storeId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!(await requireWithdrawalMfa(req, res, caller))) return;
  if (!(await allowRequest("withdrawal-approve", `${req.ip ?? "unknown"}:${caller.id}`, { limit: 30, windowSeconds: 60 }))) {
    res.status(429).json({ error: "Too many approval requests" }); return;
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
      .set({ approvalStatus: "approved", approvedBy: caller.id, approvedAt: new Date() })
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
      merchantId: u.merchantId,
    });

    updated = u;
  });

  if (!updated) {
    res.status(400).json({ error: "이미 처리된 출금입니다" }); return;
  }

  const approved = updated as WithdrawalRow;
  await writeAuditLog(req, { actorId: caller.id, action: "withdrawal.approve", resourceType: "withdrawal", resourceId: approved.id, metadata: { storeId: approved.storeId, amount: Number(approved.amount) } });
  // Provider submission is owned by the DB-backed worker. Returning after the
  // approval commit prevents a provider side effect from preceding our state.
  res.status(202).json(await formatWithdrawal(approved));
});

/** Retry an approved payout that was not yet submitted to KPPay. */
router.post("/withdrawals/:id/submit-payout", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!canManageFinance(caller)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!(await requireWithdrawalMfa(req, res, caller))) return;
  if (process.env.PAYMENT_PROVIDER_ENABLED !== "true") { res.status(503).json({ error: "KPPay payout submission is disabled" }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) { res.status(400).json({ error: "Invalid withdrawal ID" }); return; }
  const [withdrawal] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!withdrawal) { res.status(404).json({ error: "Not found" }); return; }
  if (withdrawal.merchantId && !canAccessMerchant(caller, withdrawal.merchantId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (withdrawal.approvalStatus !== "approved" || withdrawal.withdrawalStatus !== "unpaid") {
    res.status(409).json({
      error: withdrawal.withdrawalStatus === "unknown"
        ? "Provider outcome is unknown. Reconcile this payout before any retry."
        : "Withdrawal is not eligible for submission",
    });
    return;
  }
  const [queued] = await db.update(withdrawalsTable).set({
    nextSubmissionAt: new Date(),
    submissionLastError: null,
  }).where(and(
    eq(withdrawalsTable.id, withdrawal.id),
    eq(withdrawalsTable.approvalStatus, "approved"),
    eq(withdrawalsTable.withdrawalStatus, "unpaid"),
  )).returning();
  if (!queued) {
    res.status(409).json({ error: "Withdrawal state changed before it could be queued" });
    return;
  }
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "kp_pay.payout.queued",
    resourceType: "withdrawal",
    resourceId: queued.id,
    metadata: { attemptCount: queued.submissionAttemptCount },
  });
  res.status(202).json(await formatWithdrawal(queued));
});

router.post("/withdrawals/:id/reject", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  const parsed = RejectWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [candidate] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id));
  if (!candidate) { res.status(404).json({ error: "Not found" }); return; }
  if (candidate.merchantId && !canAccessMerchant(caller, candidate.merchantId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!canManageFinance(caller) || !candidate.storeId || !(await canActOn(caller, candidate.storeId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!(await allowRequest("withdrawal-reject", `${req.ip ?? "unknown"}:${caller.id}`, { limit: 30, windowSeconds: 60 }))) {
    res.status(429).json({ error: "Too many rejection requests" }); return;
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
          merchantId: r.merchantId,
        });
        await dbtx.insert(moneyLedgerTable).values({
          storeId: r.storeId,
          merchantId: r.merchantId,
          direction: "credit",
          amount: r.amount,
          entryType: "withdrawal_refund",
          referenceType: "withdrawal",
          referenceId: r.id,
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

  const rejectedWithdrawal = rejected as WithdrawalRow;
  await writeAuditLog(req, { actorId: caller.id, action: "withdrawal.reject", resourceType: "withdrawal", resourceId: rejectedWithdrawal.id, metadata: { storeId: rejectedWithdrawal.storeId, reason: parsed.data.reason } });
  res.json(await formatWithdrawal(rejectedWithdrawal));
});

router.post("/withdrawals/:id/pay", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid withdrawal id" }); return; }

  // A human must never be able to declare a bank transfer completed. Completion
  // is accepted only from the provider callback after a provider submission.
  void caller;
  void id;
  res.status(410).json({ error: "Manual payment completion is disabled; wait for the PG callback." });
});

export default router;
