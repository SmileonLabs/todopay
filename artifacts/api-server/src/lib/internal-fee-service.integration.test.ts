import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration("Sellink internal fee ledger integration", () => {
  let pool: (typeof import("@workspace/db"))["pool"];
  let applyInternalSettlement:
    typeof import("./internal-fee-service.js").applyInternalSettlement;
  let reverseAppliedInternalSettlement:
    typeof import("./internal-fee-service.js").reverseAppliedInternalSettlement;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const dbModule = await import("@workspace/db");
    const service = await import("./internal-fee-service.js");
    pool = dbModule.pool;
    applyInternalSettlement = service.applyInternalSettlement;
    reverseAppliedInternalSettlement =
      service.reverseAppliedInternalSettlement;

    await pool.query(`
      TRUNCATE TABLE
        internal_fee_ledger_entries,
        internal_fee_settlements,
        internal_fee_balances,
        fee_policy_versions,
        fee_configs,
        admin_users
      RESTART IDENTITY CASCADE
    `);
    await pool.query(`
      INSERT INTO admin_users
        (id, login_id, password_hash, name, role, permission, is_active, use_otp, parent_id)
      VALUES
        (1, 'super', 'test', '운영자', 'superadmin', 'admin', true, false, NULL),
        (2, 'hq', 'test', '본사', 'hq', 'admin', true, false, 1),
        (3, 'dist', 'test', '총판', 'distributor', 'admin', true, false, 2),
        (4, 'agency', 'test', '대리점', 'agency', 'admin', true, false, 3),
        (5, 'store', 'test', '매장', 'store', 'admin', true, false, 4)
    `);
    await pool.query(`
      INSERT INTO fee_configs
        (user_id, deposit_fee, withdrawal_fee, usage_fee_rate)
      VALUES
        (2, 0, 0, 3),
        (3, 0, 0, 2),
        (4, 0, 0, 2),
        (5, 1000, 1000, 10)
    `);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("serializes concurrent duplicates and posts one conserved allocation", async () => {
    const input = {
      sourceEventId: "tdp_evt_integration_1",
      sourceEventType: "deposit.completed" as const,
      externalTransactionId: "tdp_tx_integration_1",
      trackingNumber: "TRACK-INTEGRATION-1",
      storeId: 5,
      grossAmount: 100_000,
      todoPayFee: 1_000,
      settlementAmount: 99_000,
    };
    const results = await Promise.all([
      applyInternalSettlement(input),
      applyInternalSettlement(input),
    ]);

    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    expect(results.filter(result => result.duplicate)).toHaveLength(1);

    const ledger = await pool.query<{
      beneficiary_user_id: number;
      amount: string;
    }>(`
      SELECT beneficiary_user_id, amount
      FROM internal_fee_ledger_entries
      WHERE entry_type = 'allocation'
      ORDER BY beneficiary_user_id
    `);
    expect(ledger.rows.map(row => [
      Number(row.beneficiary_user_id),
      Number(row.amount),
    ])).toEqual([
      [2, 3_000],
      [3, 2_000],
      [4, 2_000],
      [5, 92_000],
    ]);
    expect(ledger.rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(
      99_000,
    );
  });

  it("reverses original entries after the policy changes, then snapshots v2", async () => {
    await pool.query(`
      UPDATE fee_configs
      SET usage_fee_rate = 1
      WHERE user_id IN (2, 3, 4)
    `);

    const reversal = await reverseAppliedInternalSettlement({
      sourceEventId: "tdp_evt_integration_reverse_1",
      originalSourceEventId: "tdp_evt_integration_1",
    });
    expect(reversal.duplicate).toBe(false);
    const duplicateReversal = await reverseAppliedInternalSettlement({
      sourceEventId: "tdp_evt_integration_reverse_1",
      originalSourceEventId: "tdp_evt_integration_1",
    });
    expect(duplicateReversal.duplicate).toBe(true);

    const zeroBalances = await pool.query<{ available_amount: string }>(`
      SELECT available_amount
      FROM internal_fee_balances
      ORDER BY user_id
    `);
    expect(zeroBalances.rows.every(row => Number(row.available_amount) === 0))
      .toBe(true);

    const second = await applyInternalSettlement({
      sourceEventId: "tdp_evt_integration_2",
      sourceEventType: "deposit.completed",
      externalTransactionId: "tdp_tx_integration_2",
      trackingNumber: "TRACK-INTEGRATION-2",
      storeId: 5,
      grossAmount: 100_000,
      todoPayFee: 1_000,
      settlementAmount: 99_000,
    });
    expect(second.duplicate).toBe(false);
    expect(second.allocation.entries.map(entry => [
      entry.beneficiaryUserId,
      entry.amount,
    ])).toEqual([
      [5, 96_000],
      [4, 1_000],
      [3, 1_000],
      [2, 1_000],
    ]);

    const versions = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM fee_policy_versions WHERE store_id = 5",
    );
    expect(Number(versions.rows[0].count)).toBe(2);
  });
});
