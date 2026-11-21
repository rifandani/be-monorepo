#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BASELINE } from "../.oxlint-plugins/no-comments-baseline.ts";

const ROOT = path.dirname(import.meta.dirname);

const BASELINE_FILE = path.join(
  ROOT,
  ".oxlint-plugins",
  "no-comments-baseline.ts"
);

const STALE =
  /^(?<file>.+?):\d+:\d+: This file has (?<actual>\d+) comments, and the baseline allows \d+\./u;

const lint = spawnSync(
  "bunx",
  ["oxlint", "--disable-nested-config", "--format", "unix"],
  { cwd: ROOT, encoding: "utf-8" }
);

if (lint.error) {
  throw lint.error;
}

const counts = new Map(BASELINE);

for (const line of lint.stdout.split("\n")) {
  const file = STALE.exec(line)?.groups?.file;
  const actual = STALE.exec(line)?.groups?.actual;

  if (file !== undefined && actual !== undefined) {
    counts.set(file, Number(actual));
  }
}

const entries = [...counts]
  .filter(([file, count]) => count > 0 && existsSync(path.join(ROOT, file)))
  .toSorted(([a], [b]) => a.localeCompare(b));

const body = entries
  .map(([file, count]) => `  ["${file}", ${count}],`)
  .join("\n");

writeFileSync(
  BASELINE_FILE,
  `export const BASELINE: ReadonlyMap<string, number> = new Map([\n${body}\n]);\n`
);

const before = [...BASELINE.values()].reduce((sum, count) => sum + count, 0);
const after = entries.reduce((sum, [, count]) => sum + count, 0);

console.log(
  `Comment baseline: ${before} -> ${after} in ${entries.length} files.`
);
