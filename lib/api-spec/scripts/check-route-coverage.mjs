import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const routesDir = path.join(root, "artifacts", "api-server", "src", "routes");
const specPaths = ["openapi.yaml", "openapi-runtime.yaml"].map((name) => path.join(root, "lib", "api-spec", name));

const spec = (await Promise.all(specPaths.map((file) => readFile(file, "utf8")))).join("\n");
const documented = new Set([...spec.matchAll(/^  (\/[^{\s][^:]*|\/[^:]+):\s*$/gm)].map((m) => m[1]));
const files = (await readdir(routesDir)).filter((name) => name.endsWith(".ts"));
const actual = new Set();
for (const file of files) {
  const source = await readFile(path.join(routesDir, file), "utf8");
  for (const match of source.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) {
    actual.add(match[1].replace(/:([A-Za-z0-9_]+)/g, "{$1}"));
  }
}
const missing = [...actual].filter((route) => !documented.has(route)).sort();
if (missing.length) {
  console.error(`OpenAPI is missing ${missing.length} server routes:\n${missing.join("\n")}`);
  process.exit(1);
}
console.log(`OpenAPI contracts cover all ${actual.size} registered routes.`);
