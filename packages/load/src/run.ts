#!/usr/bin/env node
/**
 * Load test runner — runs one app's k6 scenario with one load profile.
 *
 * k6 runs on this machine, never in Docker. Docker Desktop routes every
 * request through its VM network, so the latency it reports would describe
 * Docker rather than the app.
 *
 * Usage: bun packages/load/src/run.ts <app> <profile> <url> [--allow-remote]
 *   (or bun load:hono:smoke http://localhost:3000)
 *   app       hono | effect
 *   profile   smoke | load | stress | spike | breakpoint
 *   url       base URL of the app. Falls back to LOAD_TARGET. No default.
 *
 * Env:
 *   LOAD_TARGET          the URL, when no argument gives one
 *   LOAD_RATE            peak requests per second (see profiles.ts)
 *   LOAD_HOLD            how long the peak is held (see profiles.ts)
 *   LOAD_USER_EMAIL      hono only, defaults to the committed seed user
 *   LOAD_USER_PASSWORD   hono only, defaults to the committed seed user
 *
 * None of these are `K6_*`: k6 reads that prefix as its own options, and
 * `K6_DURATION` alone would replace every scenario.
 *
 * stress, spike and breakpoint can take a shared host down for everyone on
 * it, so a target that is not this machine needs `--allow-remote`. smoke and
 * load run anywhere.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SEED_USER } from "../../../apps/hono/src/db/seeds/seed-user-data.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const REPORT_DIR = path.join(REPO_ROOT, ".k6-reports");

const APPS = ["hono", "effect"] as const;
const PROFILES = ["smoke", "load", "stress", "spike", "breakpoint"] as const;
const DESTRUCTIVE_PROFILES = new Set(["stress", "spike", "breakpoint"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The type annotation sits on the const and not on the arrow: that is what
// makes TypeScript narrow after a call to it, which every guard below needs.
const fail: (message: string) => never = (message) => {
  console.error(`load: ${message}`);
  process.exit(1);
};

const isOneOf = <T extends string>(
  values: readonly T[],
  value: string | undefined
): value is T => values.some((candidate) => candidate === value);

const args = process.argv.slice(2);
const allowRemote = args.includes("--allow-remote");
const [app, profile, urlArg] = args.filter((arg) => !arg.startsWith("--"));

if (!isOneOf(APPS, app)) {
  fail(`give an app, one of ${APPS.join(", ")}`);
}
if (!isOneOf(PROFILES, profile)) {
  fail(`give a profile, one of ${PROFILES.join(", ")}`);
}

const target = urlArg ?? process.env.LOAD_TARGET;
if (!target) {
  fail(
    "a target URL is required and has no default.\n" +
      `  bun load:${app}:${profile} http://localhost:3000\n` +
      `  LOAD_TARGET=http://localhost:3000 bun load:${app}:${profile}`
  );
}

const targetUrl = URL.parse(target);
if (!targetUrl) {
  fail(`not a URL: ${target}`);
}

const isLocal =
  LOCAL_HOSTS.has(targetUrl.hostname) ||
  targetUrl.hostname.endsWith(".localhost");
if (!isLocal && DESTRUCTIVE_PROFILES.has(profile) && !allowRemote) {
  fail(
    `${profile} against ${targetUrl.host} can take it down for everyone on it.\n` +
      "  Add --allow-remote if that host is yours to break."
  );
}

const k6Version = spawnSync("k6", ["version"], { encoding: "utf-8" });
if (k6Version.error) {
  fail("k6 is not installed. Install it with `brew install k6`.");
}

mkdirSync(REPORT_DIR, { recursive: true });
const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const reportBase = path.join(REPORT_DIR, `${app}-${profile}-${stamp}`);

/** One `-e` pair for k6, or nothing when the value is not set. */
const envArg = (key: string, value: string | undefined) =>
  value === undefined ? [] : ["-e", `${key}=${value}`];

// Effect has no users, so only hono gets the sign-in pair.
const userArgs =
  app === "hono"
    ? [
        ...envArg(
          "LOAD_USER_EMAIL",
          process.env.LOAD_USER_EMAIL ?? SEED_USER.email
        ),
        ...envArg(
          "LOAD_USER_PASSWORD",
          process.env.LOAD_USER_PASSWORD ?? SEED_USER.password
        ),
      ]
    : [];

const k6Args = [
  "run",
  ...envArg("LOAD_PROFILE", profile),
  // A trailing slash would double up against the scenarios' leading one.
  ...envArg("LOAD_TARGET", target.replace(/\/+$/u, "")),
  ...envArg("LOAD_RATE", process.env.LOAD_RATE),
  ...envArg("LOAD_HOLD", process.env.LOAD_HOLD),
  ...envArg("LOAD_SUMMARY_PATH", `${reportBase}.json`),
  ...userArgs,
  path.join(import.meta.dirname, `${app}.ts`),
];

console.log(`load: ${app} ${profile} against ${target}`);
const result = spawnSync("k6", k6Args, {
  env: {
    ...process.env,
    K6_WEB_DASHBOARD: "true",
    K6_WEB_DASHBOARD_EXPORT: `${reportBase}.html`,
    // No live dashboard server: it would keep k6 alive after the run.
    K6_WEB_DASHBOARD_PORT: "-1",
  },
  stdio: "inherit",
});

console.log(
  `load: reports in ${path.relative(REPO_ROOT, reportBase)}.{json,html}`
);
// 99 is k6's exit code for a failed threshold, which is a result, not a crash.
process.exit(result.status ?? 1);
