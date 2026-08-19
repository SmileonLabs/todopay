import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = { ...process.env, NODE_ENV: "development" };

const child = spawn(pnpm, ["run", "build"], { stdio: "inherit", env, shell: false });
child.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const server = spawn(pnpm, ["run", "start"], { stdio: "inherit", env, shell: false });
  server.on("exit", (serverCode) => process.exit(serverCode ?? 0));
});
