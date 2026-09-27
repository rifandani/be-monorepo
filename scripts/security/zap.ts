#!/usr/bin/env node
/**
 * DAST runner — runs a ZAP Automation Framework plan in Docker.
 *
 * This is the local half of the pair. CI runs the same plan files through
 * `zaproxy/action-af`, which issues an equivalent `docker run` with the
 * repository root mounted at `/zap/wrk`. Keeping the two in step is why this
 * script mounts the root and not `.github/security/zap` — `reportDir` in the plans is
 * then one path for both.
 *
 * Usage: bun scripts/security/zap.ts <plan>   (or bun zap:hono:baseline)
 *   plan   one of the basenames in .github/security/zap (e.g. hono-baseline)
 *
 * Env:
 *   ZAP_TARGET          required, no default. The base URL to scan.
 *   ZAP_USER_EMAIL      auth plans only, defaults to the committed seed user
 *   ZAP_USER_PASSWORD   auth plans only, defaults to the committed seed user
 *   ZAP_IMAGE           default: ghcr.io/zaproxy/zaproxy:stable
 *
 * There is deliberately no guard on the target. The active plans have to be
 * runnable against a local stack, or the auth context and the Origin replacer
 * cannot be developed. Nothing automated points an active plan at production:
 * the scheduled workflow only ever runs a baseline.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { SEED_USER } from "../../apps/hono/src/db/seeds/seed-user-data.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const PLAN_DIR = path.join(REPO_ROOT, ".github/security/zap");
const REPORT_DIR = path.join(REPO_ROOT, ".zap-reports");
const DEFAULT_IMAGE = "ghcr.io/zaproxy/zaproxy:stable";

// The type annotation sits on the const and not on the arrow: that is what
// makes TypeScript narrow after a call to it, which every guard below needs.
const fail: (message: string) => never = (message) => {
  console.error(`zap: ${message}`);
  process.exit(1);
};

const plan = process.argv.at(2);
if (!plan) {
  fail("give a plan name, e.g. `bun scripts/security/zap.ts hono-baseline`");
}

const planPath = path.join(PLAN_DIR, `${plan}.yaml`);
if (!existsSync(planPath)) {
  fail(`no plan at ${path.relative(REPO_ROOT, planPath)}`);
}

const target = process.env.ZAP_TARGET;
if (!target) {
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

/**
 * `localhost` inside the container is the container, and Docker will not let
 * an `--add-host` entry win over the `127.0.0.1 localhost` it writes itself.
 * The portless hostname has neither problem, and it is also the value of
 * `APP_URL`, so the Origin the plans send matches what the app trusts.
 */
if (targetUrl.hostname === "localhost" && process.platform !== "linux") {
  fail(
    "a bare `localhost` target is not reachable from the ZAP container on this platform.\n" +
      "Use the portless hostname instead, which is what APP_URL holds:\n" +
      "  https://hono.be-monorepo.localhost"
  );
}

/**
 * Two ways to reach a server on the host, and Docker refuses to take both at
 * once — `--add-host` with `--network host` is a hard error.
 *
 * On Linux, host networking is what `zaproxy/action-af` uses, so CI and a Linux
 * laptop take the same path. On Docker Desktop that flag does nothing, and a
 * `*.localhost` name has to be mapped to the host gateway instead. A public
 * target needs neither.
 */
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

/**
 * The arm64 `:stable` image ships a zero-filled `/zap/zap.sh`, which fails with
 * "exec format error". amd64 works on Docker Desktop and on Linux through
 * emulation when needed. CI is already amd64, so this is a no-op there.
 */
const resolvePlatformArgs = (): string[] =>
  process.arch === "arm64" ? ["--platform", "linux/amd64"] : [];

const platformArgs = resolvePlatformArgs();

mkdirSync(REPORT_DIR, { recursive: true });
// ZAP runs as uid 1000 in the container, which is not the uid that owns a
// checkout on a CI runner. `action-af` widens the workspace for the same
// reason; this widens only the directory the plans write to.
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
