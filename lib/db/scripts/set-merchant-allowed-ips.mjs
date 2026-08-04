import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const merchantCode = process.env.MERCHANT_CODE;
const allowedIps = (process.env.MERCHANT_ALLOWED_IPS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => /^\d{1,3}(?:\.\d{1,3}){3}\/32$/.test(value));
if (!databaseUrl || !merchantCode || allowedIps.length === 0) {
  throw new Error("DATABASE_URL, MERCHANT_CODE and valid MERCHANT_ALLOWED_IPS are required");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await pool.query(
    `update merchants
       set allowed_ips = $1::text[], updated_at = now()
     where code = $2 and status = 'active'
     returning id, code, cardinality(allowed_ips) as allowed_ip_count`,
    [allowedIps, merchantCode],
  );
  if (result.rowCount !== 1) throw new Error("Active merchant was not found or update was ambiguous");
  console.log(JSON.stringify({
    updated: true,
    merchantId: result.rows[0].id,
    code: result.rows[0].code,
    allowedIpCount: result.rows[0].allowed_ip_count,
  }));
} finally {
  await pool.end();
}
