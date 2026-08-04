import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { canActOn, requireAdmin } from "../lib/auth.js";
import { simulateInternalSettlement } from "../lib/internal-fee-service.js";
import { enforceCapability } from "../lib/access-control.js";

const router = Router();

function integerWon(value: unknown): number | null {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "수수료 계산 중 오류가 발생했습니다.";
  const messages: Record<string, string> = {
    STORE_NOT_FOUND: "매장을 찾을 수 없습니다.",
    STORE_FEE_POLICY_NOT_CONFIGURED: "매장 수수료가 설정되지 않았습니다.",
    FEE_ALLOCATION_EXCEEDS_TOTAL: "하부 조직 수수료 합계가 매장 이용수수료율을 초과합니다.",
    TODOPAY_SETTLEMENT_CONSERVATION_FAILED:
      "결제금액에서 TodoPay 수수료를 뺀 금액과 정산금액이 일치하지 않습니다.",
    ORGANIZATION_COMMISSION_EXCEEDS_SETTLEMENT:
      "조직 수수료 합계가 실제 정산금액을 초과합니다.",
  };
  if (error.message.startsWith("ORGANIZATION_FEE_POLICY_NOT_CONFIGURED:")) {
    return "수수료가 설정되지 않은 상위 조직이 있습니다.";
  }
  return messages[error.message] ?? error.message;
}

router.post("/internal-fees/simulate", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "fees.read", res)) return;

  const storeId = Number(req.body?.storeId);
  const grossAmount = integerWon(req.body?.grossAmount);
  const todoPayFee = integerWon(req.body?.todoPayFee);
  const settlementAmount = integerWon(req.body?.settlementAmount);
  if (
    !Number.isSafeInteger(storeId) ||
    storeId <= 0 ||
    grossAmount == null ||
    todoPayFee == null ||
    settlementAmount == null
  ) {
    res.status(400).json({ error: "금액은 0 이상의 원 단위 정수여야 합니다." });
    return;
  }
  if (!(await canActOn(caller, storeId))) {
    res.status(403).json({ error: "해당 매장의 수수료를 조회할 권한이 없습니다." });
    return;
  }

  try {
    const result = await simulateInternalSettlement({
      storeId,
      grossAmount,
      todoPayFee,
      settlementAmount,
    });
    res.json({
      ...result,
      note: "건당 고정 수수료는 수취 주체가 확정되기 전까지 내부 배분에서 차감하지 않습니다.",
    });
  } catch (error) {
    res.status(409).json({ error: errorMessage(error) });
  }
});

router.get("/internal-fees/ledger", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "fees.read", res)) return;
  const storeId = Number(req.query.storeId);
  if (!Number.isSafeInteger(storeId) || storeId <= 0) {
    res.status(400).json({ error: "유효한 매장 ID가 필요합니다." });
    return;
  }
  if (!(await canActOn(caller, storeId))) {
    res.status(403).json({ error: "해당 매장의 원장을 조회할 권한이 없습니다." });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const result = await db.execute(sql`
    SELECT
      ledger.id,
      ledger.source_event_id,
      ledger.beneficiary_user_id,
      users.name AS beneficiary_name,
      users.role,
      ledger.entry_type,
      ledger.component,
      ledger.rate,
      ledger.amount,
      ledger.commission_amount,
      ledger.created_at,
      settlements.tracking_number,
      settlements.gross_amount,
      settlements.todopay_fee,
      settlements.settlement_amount,
      settlements.status
    FROM internal_fee_ledger_entries ledger
    JOIN internal_fee_settlements settlements
      ON settlements.id = ledger.settlement_id
    LEFT JOIN admin_users users ON users.id = ledger.beneficiary_user_id
    WHERE ledger.store_id = ${storeId}
    ORDER BY ledger.id DESC
    LIMIT ${limit}
  `);
  res.json((result as unknown as { rows: unknown[] }).rows);
});

router.get("/internal-fees/reconciliation", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "fees.read", res)) return;
  const storeId = Number(req.query.storeId);
  if (!Number.isSafeInteger(storeId) || storeId <= 0) {
    res.status(400).json({ error: "유효한 매장 ID가 필요합니다." });
    return;
  }
  if (!(await canActOn(caller, storeId))) {
    res.status(403).json({ error: "해당 매장의 원장을 조회할 권한이 없습니다." });
    return;
  }
  const result = await db.execute(sql`
    WITH ledger_totals AS (
      SELECT beneficiary_user_id, SUM(amount) AS ledger_amount
      FROM internal_fee_ledger_entries
      WHERE store_id = ${storeId}
      GROUP BY beneficiary_user_id
    )
    SELECT
      ledger_totals.beneficiary_user_id,
      users.name AS beneficiary_name,
      ledger_totals.ledger_amount,
      COALESCE(balances.available_amount, 0) AS cached_amount,
      ledger_totals.ledger_amount - COALESCE(balances.available_amount, 0)
        AS difference
    FROM ledger_totals
    LEFT JOIN internal_fee_balances balances
      ON balances.user_id = ledger_totals.beneficiary_user_id
     AND balances.store_id = ${storeId}
    LEFT JOIN admin_users users
      ON users.id = ledger_totals.beneficiary_user_id
    ORDER BY ledger_totals.beneficiary_user_id
  `);
  const rows = (result as unknown as {
    rows: Array<{ difference: string | number }>;
  }).rows;
  res.json({
    reconciled: rows.every(row => Number(row.difference) === 0),
    items: rows,
  });
});

export default router;
