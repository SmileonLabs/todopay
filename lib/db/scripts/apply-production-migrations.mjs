import { readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

const migrations = ["001_member_registration.sql", "002_financial_resilience.sql"];
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const migration of migrations) {
    const statement = await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
    await client.query(statement);
    console.log(`TodoPay production migration applied: ${migration}`);
  }
} finally {
  await client.end();
}
