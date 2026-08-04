import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // drizzle-kit treats this value as a glob. Normalize Windows separators so
  // local migration verification finds the same schema files as Linux deploys.
  schema: fileURLToPath(
    new URL("./src/schema/index.ts", import.meta.url),
  ).replaceAll("\\", "/"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
