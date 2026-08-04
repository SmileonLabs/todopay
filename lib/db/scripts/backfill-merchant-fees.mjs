import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(`
    insert into merchant_fee_configs (
      merchant_id,
      deposit_fee,
      withdrawal_fee,
      usage_fee_rate,
      effective_from,
      updated_by,
      created_at,
      updated_at
    )
    select distinct on (administrator.merchant_id)
      administrator.merchant_id,
      legacy.deposit_fee,
      legacy.withdrawal_fee,
      legacy.usage_fee_rate,
      now(),
      administrator.id,
      now(),
      now()
    from admin_users administrator
    inner join fee_configs legacy on legacy.user_id = administrator.id
    where administrator.merchant_id is not null
    order by administrator.merchant_id, administrator.id
    on conflict (merchant_id) do nothing
  `);
  console.log(
    `merchant fee backfill complete: ${result.rowCount ?? 0} row(s) inserted`,
  );
} finally {
  await client.end();
}
