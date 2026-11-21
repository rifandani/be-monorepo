import path from "node:path";

import { beforeEach } from "vitest";

const REPO_ROOT = import.meta.dirname;

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

export const numRuns = readInteger("PBT_NUM_RUNS") ?? DEFAULT_RUNS;

export const seed =
  readInteger("PBT_SEED") ?? Math.floor(Math.random() * 2 ** 31);

const REPLAY_PREFIX = "Replay: PBT_SEED=";

const toPattern = (name: string) =>
  name
    .replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)
    .replaceAll("'", String.raw`'\''`);

const replayLine = (filepath: string, name: string) =>
  `${REPLAY_PREFIX}${seed} PBT_NUM_RUNS=${numRuns} bun run test ${path.relative(REPO_ROOT, filepath)} -t '${toPattern(name)}'`;

const withReplay = (message: string, line: string) =>
  message.includes(REPLAY_PREFIX) ? message : `${message}\n\n${line}`;

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
