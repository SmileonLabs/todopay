import crypto from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  calculateInternalSettlement,
  type InternalFeePolicy,
  type InternalSettlementAllocation,
} from "./internal-fee-calculator.js";

type PolicyRow = {
  id: number;
  name: string;
  role: string;
  parent_id: number | null;
  depth: number;
  fee_config_id: number | null;
  deposit_fee: number | string | null;
  withdrawal_fee: number | string | null;
  usage_fee_rate: number | string | null;
};

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

function stablePolicyHash(policy: InternalFeePolicy): string {
  const value = JSON.stringify({
    storeId: policy.storeId,
    totalRate: policy.totalRate,
    depositFee: policy.depositFee,
    withdrawalFee: policy.withdrawalFee,
    organizationRates: policy.organizationRates.map(item => ({
      userId: item.userId,
      role: item.role,
      rate: item.rate,
    })),
  });
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mapPolicyRows(storeId: number, rows: PolicyRow[]): InternalFeePolicy {
  const orderedRows = [...rows].sort((a, b) => Number(a.depth) - Number(b.depth));
  const last = orderedRows.at(-1);
  if (last?.parent_id != null) {
    throw new Error("FEE_HIERARCHY_CYCLE_OR_TOO_DEEP");
  }
  const store = rows.find(row => Number(row.id) === storeId && row.role === "store");
  if (!store) throw new Error("STORE_NOT_FOUND");
  if (store.fee_config_id == null) {
    throw new Error("STORE_FEE_POLICY_NOT_CONFIGURED");
  }

  const organizations = rows
    .filter(row => Number(row.id) !== storeId && row.role !== "superadmin")
    .sort((a, b) => Number(a.depth) - Number(b.depth));
  const missing = organizations.find(row => row.fee_config_id == null);
  if (missing) {
    throw new Error(`ORGANIZATION_FEE_POLICY_NOT_CONFIGURED:${missing.id}`);
  }

  return {
    storeId,
    storeName: store.name,
    totalRate: Number(store.usage_fee_rate),
    depositFee: Number(store.deposit_fee),
    withdrawalFee: Number(store.withdrawal_fee),
    organizationRates: organizations.map(row => ({
      userId: Number(row.id),
      role: row.role,
      name: row.name,
      rate: Number(row.usage_fee_rate),
    })),
  };
}

const POLICY_QUERY = (storeId: number) => sql`
  WITH RECURSIVE hierarchy AS (
    SELECT id, name, role, parent_id, 0 AS depth, ARRAY[id] AS path
    FROM admin_users
    WHERE id = ${storeId}
    UNION ALL
    SELECT
      parent.id,
      parent.name,
      parent.role,
      parent.parent_id,
      hierarchy.depth + 1,
      hierarchy.path || parent.id
    FROM admin_users parent
    JOIN hierarchy ON parent.id = hierarchy.parent_id
    WHERE NOT parent.id = ANY(hierarchy.path)
      AND hierarchy.depth < 10
  )
  SELECT
    hierarchy.id,
    hierarchy.name,
    hierarchy.role,
    hierarchy.parent_id,
    hierarchy.depth,
    fee_configs.id AS fee_config_id,
    fee_configs.deposit_fee,
    fee_configs.withdrawal_fee,
    fee_configs.usage_fee_rate
  FROM hierarchy
  LEFT JOIN fee_configs ON fee_configs.user_id = hierarchy.id
  ORDER BY hierarchy.depth
`;

export async function loadInternalFeePolicy(
  storeId: number,
): Promise<InternalFeePolicy> {
  const result = await db.execute(POLICY_QUERY(storeId));
  return mapPolicyRows(storeId, rowsOf<PolicyRow>(result));
}

export async function simulateInternalSettlement(input: {
  storeId: number;
  grossAmount: number;
  todoPayFee: number;
  settlementAmount: number;
}): Promise<{ policy: InternalFeePolicy; allocation: InternalSettlementAllocation }> {
  const policy = await loadInternalFeePolicy(input.storeId);
  return {
    policy,
    allocation: calculateInternalSettlement({ ...input, policy }),
  };
}

export type ApplyInternalSettlementInput = {
  sourceEventId: string;
  sourceEventType: "deposit.completed";
  externalTransactionId: string;
  trackingNumber: string;
  storeId: number;
  grossAmount: number;
  todoPayFee: number;
  settlementAmount: number;
  metadata?: Record<string, unknown>;
};

/**
 * Atomically books a Sellink settlement exactly once.
 *
 * This is intentionally not wired to the live webhook yet. The TodoPay event
 * must first carry a trusted Sellink store reference (or resolve through a
 * verified integration mapping). Until then, production activation stays off.
 */
export async function applyInternalSettlement(
  input: ApplyInternalSettlementInput,
): Promise<{ duplicate: boolean; settlementId: number; allocation: InternalSettlementAllocation }> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73001, ${input.storeId})`);

    const policyResult = await tx.execute(POLICY_QUERY(input.storeId));
    const policy = mapPolicyRows(
      input.storeId,
      rowsOf<PolicyRow>(policyResult),
    );
    const allocation = calculateInternalSettlement({ ...input, policy });
    const configurationHash = stablePolicyHash(policy);

    const existingPolicyResult = await tx.execute(sql`
      SELECT id
      FROM fee_policy_versions
      WHERE store_id = ${input.storeId}
        AND configuration_hash = ${configurationHash}
      LIMIT 1
    `);
    let policyVersionId = rowsOf<{ id: number }>(existingPolicyResult)[0]?.id;
    if (!policyVersionId) {
      const insertedPolicyResult = await tx.execute(sql`
        INSERT INTO fee_policy_versions (
          store_id,
          version,
          total_rate,
          deposit_fee,
          withdrawal_fee,
          configuration_hash,
          allocation_snapshot
        )
        VALUES (
          ${input.storeId},
          (
            SELECT COALESCE(MAX(version), 0) + 1
            FROM fee_policy_versions
            WHERE store_id = ${input.storeId}
          ),
          ${String(policy.totalRate)},
          ${policy.depositFee},
          ${policy.withdrawalFee},
          ${configurationHash},
          ${JSON.stringify(policy)}::jsonb
        )
        RETURNING id
      `);
      policyVersionId = rowsOf<{ id: number }>(insertedPolicyResult)[0]?.id;
    }
    if (!policyVersionId) throw new Error("FEE_POLICY_VERSION_CREATE_FAILED");

    const insertedSettlementResult = await tx.execute(sql`
      INSERT INTO internal_fee_settlements (
        source_event_id,
        source_event_type,
        external_transaction_id,
        tracking_number,
        store_id,
        policy_version_id,
        gross_amount,
        todopay_fee,
        settlement_amount,
        internal_fee_amount,
        store_commission_amount,
        metadata
      )
      VALUES (
        ${input.sourceEventId},
        ${input.sourceEventType},
        ${input.externalTransactionId},
        ${input.trackingNumber},
        ${input.storeId},
        ${policyVersionId},
        ${input.grossAmount},
        ${input.todoPayFee},
        ${input.settlementAmount},
        ${allocation.internalFeeAmount},
        ${allocation.storeCommissionAmount},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      ON CONFLICT (source_event_id) DO NOTHING
      RETURNING id
    `);
    const insertedSettlement =
      rowsOf<{ id: number }>(insertedSettlementResult)[0];
    if (!insertedSettlement) {
      const existingResult = await tx.execute(sql`
        SELECT id
        FROM internal_fee_settlements
        WHERE source_event_id = ${input.sourceEventId}
        LIMIT 1
      `);
      const existing = rowsOf<{ id: number }>(existingResult)[0];
      if (!existing) throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
      return {
        duplicate: true,
        settlementId: Number(existing.id),
        allocation,
      };
    }

    for (const entry of allocation.entries) {
      const idempotencyKey =
        `${input.sourceEventId}:allocation:${entry.beneficiaryUserId}`;
      await tx.execute(sql`
        INSERT INTO internal_fee_ledger_entries (
          settlement_id,
          source_event_id,
          idempotency_key,
          beneficiary_user_id,
          store_id,
          entry_type,
          component,
          rate,
          amount,
          commission_amount
        )
        VALUES (
          ${insertedSettlement.id},
          ${input.sourceEventId},
          ${idempotencyKey},
          ${entry.beneficiaryUserId},
          ${input.storeId},
          'allocation',
          ${entry.component},
          ${String(entry.rate)},
          ${entry.amount},
          ${entry.commissionAmount}
        )
      `);
      await tx.execute(sql`
        INSERT INTO internal_fee_balances (user_id, store_id, available_amount, updated_at)
        VALUES (${entry.beneficiaryUserId}, ${input.storeId}, ${entry.amount}, NOW())
        ON CONFLICT (user_id, store_id) DO UPDATE
          SET available_amount =
                internal_fee_balances.available_amount + EXCLUDED.available_amount,
              updated_at = NOW()
      `);
    }

    return {
      duplicate: false,
      settlementId: Number(insertedSettlement.id),
      allocation,
    };
  });
}

export async function reverseAppliedInternalSettlement(input: {
  sourceEventId: string;
  originalSourceEventId: string;
}): Promise<{ duplicate: boolean; settlementId: number }> {
  return db.transaction(async tx => {
    const settlementResult = await tx.execute(sql`
      SELECT id, store_id, status, reversed_by_event_id
      FROM internal_fee_settlements
      WHERE source_event_id = ${input.originalSourceEventId}
      FOR UPDATE
    `);
    const settlement = rowsOf<{
      id: number;
      store_id: number;
      status: string;
      reversed_by_event_id: string | null;
    }>(settlementResult)[0];
    if (!settlement) throw new Error("ORIGINAL_SETTLEMENT_NOT_FOUND");
    if (settlement.status === "reversed") {
      if (settlement.reversed_by_event_id === input.sourceEventId) {
        return { duplicate: true, settlementId: Number(settlement.id) };
      }
      throw new Error("SETTLEMENT_ALREADY_REVERSED");
    }

    const entriesResult = await tx.execute(sql`
      SELECT id, beneficiary_user_id, component, rate, amount, commission_amount
      FROM internal_fee_ledger_entries
      WHERE settlement_id = ${settlement.id}
        AND entry_type = 'allocation'
      ORDER BY id
    `);
    const entries = rowsOf<{
      id: number;
      beneficiary_user_id: number;
      component: string;
      rate: string;
      amount: string;
      commission_amount: string;
    }>(entriesResult);
    if (entries.length === 0) throw new Error("ORIGINAL_LEDGER_ENTRIES_NOT_FOUND");

    for (const entry of entries) {
      const amount = -Number(entry.amount);
      const commissionAmount = -Number(entry.commission_amount);
      await tx.execute(sql`
        INSERT INTO internal_fee_ledger_entries (
          settlement_id,
          source_event_id,
          idempotency_key,
          beneficiary_user_id,
          store_id,
          entry_type,
          component,
          rate,
          amount,
          commission_amount,
          reference_entry_id
        )
        VALUES (
          ${settlement.id},
          ${input.sourceEventId},
          ${`${input.sourceEventId}:reversal:${entry.id}`},
          ${entry.beneficiary_user_id},
          ${settlement.store_id},
          'reversal',
          ${entry.component},
          ${entry.rate},
          ${amount},
          ${commissionAmount},
          ${entry.id}
        )
      `);
      await tx.execute(sql`
        INSERT INTO internal_fee_balances (user_id, store_id, available_amount, updated_at)
        VALUES (${entry.beneficiary_user_id}, ${settlement.store_id}, ${amount}, NOW())
        ON CONFLICT (user_id, store_id) DO UPDATE
          SET available_amount =
                internal_fee_balances.available_amount + EXCLUDED.available_amount,
              updated_at = NOW()
      `);
    }

    await tx.execute(sql`
      UPDATE internal_fee_settlements
      SET status = 'reversed',
          reversed_by_event_id = ${input.sourceEventId},
          reversed_at = NOW()
      WHERE id = ${settlement.id}
    `);

    return { duplicate: false, settlementId: Number(settlement.id) };
  });
}
