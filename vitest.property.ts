import path from "node:path";

import { beforeEach } from "vitest";

/**
 * The one budget for property tests in both apps. `apps/hono` gives it to
 * fast-check and `apps/effect` gives it to the Effect `Arbitrary` engine, each
 * from its own `vitest.setup.ts`. Every value can be set from the environment,
 * so a failure found by one run can be replayed by another.
 *
 * The reasons for each value are in
 * `docs/adr/0005-property-based-tests.md`.
 */

const REPO_ROOT = import.meta.dirname;

/** Runs per property: 100 in CI, 25 for local and agent runs. */
const DEFAULT_RUNS = process.env.CI === undefined ? 25 : 100;

const readInteger = (name: string): number | undefined => {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer, got "${raw}"`);
  }

  return value;
};

/**
 * Runs per property. `PBT_NUM_RUNS` overrides the default.
 */
export const numRuns = readInteger("PBT_NUM_RUNS") ?? DEFAULT_RUNS;

/**
 * The seed of this worker. `PBT_SEED` fixes it. Without it, each worker picks
 * a new one, so each run tries new inputs.
 */
export const seed =
  readInteger("PBT_SEED") ?? Math.floor(Math.random() * 2 ** 31);

const REPLAY_PREFIX = "Replay: PBT_SEED=";

/**
 * The test name as a `-t` value. `-t` reads its value as a pattern, so the
 * pattern characters are escaped. The value goes in single quotes, so the
 * shell does not expand it.
 */
const toPattern = (name: string) =>
  name
    .replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)
    .replaceAll("'", String.raw`'\''`);

/**
 * The replay line of one test. It carries the run count too: the same seed
 * gives the same inputs only for the same number of runs, and CI runs more
 * than a local run.
 */
const replayLine = (filepath: string, name: string) =>
  `${REPLAY_PREFIX}${seed} PBT_NUM_RUNS=${numRuns} bun run test run ${path.relative(REPO_ROOT, filepath)} -t '${toPattern(name)}'`;

/**
 * Adds the replay line to a message once. The same error can reach the hook
 * more than one time.
 */
const withReplay = (message: string, line: string) =>
  message.includes(REPLAY_PREFIX) ? message : `${message}\n\n${line}`;

/**
 * Adds one replay line to the error of each failed test:
 * `Replay: PBT_SEED=<seed> PBT_NUM_RUNS=<runs> bun run test run <file> -t '<name>'`.
 *
 * An agent or a person can run that line as it is. It is on every failure, not
 * only on property failures, because a seed that is not used does no harm.
 */
export const registerReplayHint = () => {
  beforeEach(({ onTestFailed, task }) => {
    const line = replayLine(task.file.filepath, task.name);

    onTestFailed(({ task: failed }) => {
      for (const error of failed.result?.errors ?? []) {
        error.message = withReplay(error.message, line);
      }
    });
  });
};
