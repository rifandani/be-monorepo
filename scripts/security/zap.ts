#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { SEED_USER } from "../../apps/hono/src/server/db/seeds/seed-user-data.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const PLAN_DIR = path.join(REPO_ROOT, ".github/security/zap");
const REPORT_DIR = path.join(REPO_ROOT, ".zap-reports");
const DEFAULT_IMAGE = "ghcr.io/zaproxy/zaproxy:stable";

const fail: (message: string) => never = (message) => {
  console.error(`zap: ${message}`);
  process.exit(1);
};

const plan = process.argv.at(2);

if (plan === undefined || plan.length === 0) {
  fail("give a plan name, e.g. `bun scripts/security/zap.ts hono-baseline`");
}

const planPath = path.join(PLAN_DIR, `${plan}.yaml`);

if (!existsSync(planPath)) {
  fail(`no plan at ${path.relative(REPO_ROOT, planPath)}`);
}

const target = process.env.ZAP_TARGET;

if (target === undefined || target.length === 0) {
  fail(
    "ZAP_TARGET is required and has no default.\n" +
      "  local hono:   ZAP_TARGET=https://hono.be-monorepo.localhost bun zap:hono:baseline\n" +
      "  local effect: ZAP_TARGET=https://effect.be-monorepo.localhost bun zap:effect:baseline\n" +
      "  local effect active: ZAP_TARGET=https://effect.be-monorepo.localhost bun zap:effect:active"
  );
}

const targetUrl = URL.parse(target);

if (!targetUrl) {
  fail(`ZAP_TARGET is not a URL: ${target}`);
}

if (targetUrl.hostname === "localhost" && process.platform !== "linux") {
  fail(
    "a bare `localhost` target is not reachable from the ZAP container on this platform.\n" +
      "Use the portless hostname instead, which is what APP_URL holds:\n" +
      "  https://hono.be-monorepo.localhost"
  );
}

const resolveNetworkArgs = (url: URL): string[] => {
  if (process.platform === "linux") {
    return ["--network", "host"];
  }

  if (url.hostname.endsWith(".localhost")) {
    return ["--add-host", `${url.hostname}:host-gateway`];
  }

  return [];
};

const networkArgs = resolveNetworkArgs(targetUrl);

const resolvePlatformArgs = (): string[] =>
  process.arch === "arm64" ? ["--platform", "linux/amd64"] : [];

const platformArgs = resolvePlatformArgs();

mkdirSync(REPORT_DIR, { recursive: true });

chmodSync(REPORT_DIR, 0o777);

const dockerEnv = {
  ZAP_TARGET: target,
  ZAP_USER_EMAIL: process.env.ZAP_USER_EMAIL ?? SEED_USER.email,
  ZAP_USER_PASSWORD: process.env.ZAP_USER_PASSWORD ?? SEED_USER.password,
};

const args = [
  "run",
  "--rm",
  ...platformArgs,
  ...networkArgs,
  ...Object.entries(dockerEnv).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]),
  "-v",
  `${REPO_ROOT}:/zap/wrk/:rw`,
  ...(process.stdout.isTTY ? ["-t"] : []),
  process.env.ZAP_IMAGE ?? DEFAULT_IMAGE,
  "zap.sh",
  "-cmd",
  "-autorun",
  `/zap/wrk/.github/security/zap/${plan}.yaml`,
];

console.log(`zap: ${plan} against ${target}`);

const result = spawnSync("docker", args, { stdio: "inherit" });

if (result.error) {
  fail(
    `could not run docker (${result.error.message}). Is the daemon running?`
  );
}

if (readdirSync(REPORT_DIR).length > 0) {
  console.log(`zap: reports in ${path.relative(REPO_ROOT, REPORT_DIR)}/`);
}

process.exit(result.status ?? 1);
