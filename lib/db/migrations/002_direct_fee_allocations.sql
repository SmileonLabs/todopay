BEGIN;

CREATE TABLE IF NOT EXISTS sellink_data_migrations (
  name text PRIMARY KEY,
  applied_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sellink_data_migrations
    WHERE name = '002_direct_fee_allocations'
  ) THEN
    WITH original_rates AS (
      SELECT
        fc.user_id,
        fc.usage_fee_rate,
        COALESCE(parent_fc.usage_fee_rate, 0) AS parent_usage_fee_rate
      FROM fee_configs fc
      JOIN admin_users au ON au.id = fc.user_id
      LEFT JOIN fee_configs parent_fc ON parent_fc.user_id = au.parent_id
      WHERE au.role <> 'store'
    )
    UPDATE fee_configs target
    SET usage_fee_rate = GREATEST(
      0,
      original_rates.usage_fee_rate - original_rates.parent_usage_fee_rate
    )
    FROM original_rates
    WHERE target.user_id = original_rates.user_id;

    INSERT INTO sellink_data_migrations (name)
    VALUES ('002_direct_fee_allocations');
  END IF;
END $$;

COMMIT;
