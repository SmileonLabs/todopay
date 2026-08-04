import crypto from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const merchantCode = process.env.MERCHANT_CODE;
const apiKey = process.env.MERCHANT_API_KEY;
if (!databaseUrl || !merchantCode || !apiKey) {
  throw new Error("DATABASE_URL, MERCHANT_CODE and MERCHANT_API_KEY are required");
}
if (!/^tp_live_[A-Za-z0-9_-]{32,}$/.test(apiKey)) {
  throw new Error("MERCHANT_API_KEY has an invalid format");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const result = await pool.query(
    `update merchants
       set api_key_hash = $1, api_key_prefix = $2, updated_at = now()
     where code = $3 and status = 'active'
     returning id, code`,
    [apiKeyHash, apiKey.slice(0, 16), merchantCode],
  );
  if (result.rowCount !== 1) throw new Error("Active merchant was not found or update was ambiguous");
  console.log(JSON.stringify({ updated: true, merchantId: result.rows[0].id, code: result.rows[0].code }));
} finally {
  await pool.end();
}
