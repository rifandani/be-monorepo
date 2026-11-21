#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SEED_USER } from "../../../../apps/hono/src/server/db/seeds/seed-user-data.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const REPORT_DIR = path.join(REPO_ROOT, ".k6-reports");

const APPS = ["hono", "effect"] as const;
const PROFILES = ["smoke", "load", "stress", "spike", "breakpoint"] as const;
const DESTRUCTIVE_PROFILES = new Set(["stress", "spike", "breakpoint"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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

if (target === undefined || target.length === 0) {
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

const envArg = (key: string, value: string | undefined) =>
  value === undefined ? [] : ["-e", `${key}=${value}`];

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
  ...envArg("LOAD_TARGET", target.replace(/\/+$/u, "")),
  ...envArg("LOAD_RATE", process.env.LOAD_RATE),
  ...envArg("LOAD_HOLD", process.env.LOAD_HOLD),
  ...envArg("LOAD_SUMMARY_PATH", `${reportBase}.json`),
  ...userArgs,
  path.join(import.meta.dirname, "../features", app, "index.ts"),
];

console.log(`load: ${app} ${profile} against ${target}`);

const result = spawnSync("k6", k6Args, {
  env: {
    ...process.env,
    K6_WEB_DASHBOARD: "true",
    K6_WEB_DASHBOARD_EXPORT: `${reportBase}.html`,
    K6_WEB_DASHBOARD_PORT: "-1",
  },
  stdio: "inherit",
});

console.log(
  `load: reports in ${path.relative(REPO_ROOT, reportBase)}.{json,html}`
);

process.exit(result.status ?? 1);
