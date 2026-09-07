#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePnpmCli } from "../e2e/runner-layout.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCli = resolvePnpmCli(process.env.npm_execpath);
const target = process.argv[2] === "desktop" ? "dev:desktop" : "dev:webui:fixture";
const resolveFixtureRoot = (value, fallback) => path.resolve(workspaceRoot, value?.trim() || fallback);
const env = {
  ...process.env,
  MDCZ_NETWORK_FIXTURE_MODE: "replay",
  MDCZ_REPLAY_DELAY_MS: process.env.MDCZ_REPLAY_DELAY_MS?.trim() || "500",
  MDCZ_NETWORK_FIXTURES_ROOT: resolveFixtureRoot(process.env.MDCZ_NETWORK_FIXTURES_ROOT, "tests/fixtures/network"),
};
const command = /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? process.execPath : pnpmCli;
const commandArgs = /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? [pnpmCli, target] : [target];
const child = spawn(command, commandArgs, { cwd: workspaceRoot, env, stdio: "inherit" });
const shutdown = () => child.kill("SIGTERM");
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
      resolve();
      return;
    }
    reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code ?? signal}`));
  });
});
