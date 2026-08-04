import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vitePackageJson = require.resolve("vite/package.json");
const viteBin = path.resolve(path.dirname(vitePackageJson), "bin", "vite.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");

const mode = process.argv[2];

if (!mode || !["merchant", "partner", "platform"].includes(mode)) {
  console.error([
    "TodoPay frontend build requires an explicit target mode.",
    "Use one of:",
    "  pnpm --dir artifacts/todopay run build:merchant",
    "  pnpm --dir artifacts/todopay run build:partner",
    "  pnpm --dir artifacts/todopay run build:platform",
  ].join("\n"));
  process.exit(1);
}

const env = { ...process.env };
if (mode === "merchant") delete env.VITE_APP_MODE;
else env.VITE_APP_MODE = mode;

const result = spawnSync(process.execPath, [viteBin, "build", "--config", "vite.config.ts"], {
  cwd: appDir,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
