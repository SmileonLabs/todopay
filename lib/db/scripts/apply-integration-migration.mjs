import { readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const migrationFiles = [
  "001_todopay_integration.sql",
  "002_direct_fee_allocations.sql",
  "003_member_registration_sessions.sql",
  "004_internal_fee_ledger.sql",
  "005_totp_enrollment.sql",
  "006_audit_log_metadata.sql",
];
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const migrationFile of migrationFiles) {
    const sql = await readFile(
      new URL(`../migrations/${migrationFile}`, import.meta.url),
      "utf8",
    );
    await client.query(sql);
    console.log(`Sellink migration applied: ${migrationFile}`);
  }
} finally {
  await client.end();
}
