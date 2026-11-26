import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as schema from "#server/db/schema.ts";

import type {
  DeleteBatch,
  Expiry,
  PurgeResult,
  Retention,
} from "./retention.ts";
import {
  cutoffOf,
  DAY_MS,
  HOUR_MS,
  purgeExpired,
  RETENTION,
} from "./retention.ts";

type Value = Date | number;

const NOW = new Date("2026-11-26T12:00:00.000Z");

const exportedTableNames = () =>
  Object.values<unknown>(schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => getTableName(table));

const expiryEntries = () =>
  Object.entries<Retention>(RETENTION).filter(
    (entry): entry is [string, Expiry] => entry[1] !== "keep"
  );

const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const fakeStore = (initial: Record<string, readonly Value[]>) => {
  const tables = new Map<string, Value[]>(
    Object.entries(initial).map(([name, values]) => [name, [...values]])
  );

  const deleteBatch: DeleteBatch = async (expiry, cutoff, limit) => {
    const name = getTableName(expiry.table);
    let deleted = 0;

    const kept = (tables.get(name) ?? []).filter((value) => {
      const expired = deleted < limit && Number(value) < Number(cutoff);
      deleted += expired ? 1 : 0;

      return !expired;
    });

    tables.set(name, kept);

    return deleted;
  };

  return { deleteBatch, rows: (name: string) => tables.get(name) ?? [] };
};

const resultFor = (results: readonly PurgeResult[], table: string) =>
  results.find((result) => result.table === table);

describe("RETENTION map", () => {
  it("should have an entry for each table that the schema exports", () => {
    const missing = exportedTableNames().filter(
      (name) => !Object.hasOwn(RETENTION, name)
    );

    expect(missing).toStrictEqual([]);
  });

  it("should have no entry for a table that the schema does not export", () => {
    const tables = new Set(exportedTableNames());

    const stale = Object.keys(RETENTION).filter((name) => !tables.has(name));

    expect(stale).toStrictEqual([]);
  });

  it("should point each expiry at columns of its own table", () => {
    const wrong = expiryEntries()
      .filter(
        ([name, expiry]) =>
          getTableName(expiry.table) !== name ||
          expiry.key.table !== expiry.table ||
          expiry.column.table !== expiry.table
      )
      .map(([name]) => name);

    expect(wrong).toStrictEqual([]);
  });
});

describe(cutoffOf, () => {
  it("should give a date one day before now for sessions", () => {
    const cutoff = cutoffOf(RETENTION.session, NOW);

    expect(cutoff).toStrictEqual(new Date("2026-11-25T12:00:00.000Z"));
  });

  it("should give epoch milliseconds for the rate limit column", () => {
    const cutoff = cutoffOf(RETENTION.rate_limit, NOW);

    expect(cutoff).toBe(NOW.getTime() - DAY_MS);
  });

  it("should keep verification rows for one hour after they expire", () => {
    const cutoff = cutoffOf(RETENTION.verification, NOW);

    expect(cutoff).toStrictEqual(new Date(NOW.getTime() - HOUR_MS));
  });
});

describe(purgeExpired, () => {
  it("should delete the rows older than the cutoff and keep the newer rows", async () => {
    const store = fakeStore({ session: [daysBefore(3), daysBefore(0.5)] });

    await purgeExpired({ deleteBatch: store.deleteBatch, now: NOW });

    expect(store.rows("session")).toStrictEqual([daysBefore(0.5)]);
  });

  it("should report the count of deleted rows for each expiring table", async () => {
    const store = fakeStore({
      rate_limit: [NOW.getTime() - 2 * DAY_MS],
      session: [daysBefore(3), daysBefore(4)],
    });

    const results = await purgeExpired({
      deleteBatch: store.deleteBatch,
      now: NOW,
    });

    expect(results).toStrictEqual([
      { deleted: 1, drained: true, table: "rate_limit" },
      { deleted: 2, drained: true, table: "session" },
      { deleted: 0, drained: true, table: "verification" },
    ]);
  });

  it("should not touch a table with the keep policy", async () => {
    const store = fakeStore({ user: [daysBefore(400)] });

    await purgeExpired({ deleteBatch: store.deleteBatch, now: NOW });

    expect(store.rows("user")).toStrictEqual([daysBefore(400)]);
  });

  it("should stop after the maximum of batches and report that it did not drain", async () => {
    const store = fakeStore({
      session: Array.from({ length: 5 }, () => daysBefore(3)),
    });

    const results = await purgeExpired({
      batchSize: 2,
      deleteBatch: store.deleteBatch,
      maxBatches: 2,
      now: NOW,
    });

    expect(resultFor(results, "session")).toStrictEqual({
      deleted: 4,
      drained: false,
      table: "session",
    });
  });

  it("should succeed with nothing to delete when an earlier run deleted the rows", async () => {
    const store = fakeStore({ session: [daysBefore(3)] });
    await purgeExpired({ deleteBatch: store.deleteBatch, now: NOW });

    const results = await purgeExpired({
      deleteBatch: store.deleteBatch,
      now: NOW,
    });

    expect(resultFor(results, "session")).toStrictEqual({
      deleted: 0,
      drained: true,
      table: "session",
    });
  });

  it("should propagate a failed delete", async () => {
    const failure = new Error("connection refused");

    const run = purgeExpired({
      deleteBatch: async () => Promise.reject(failure),
      now: NOW,
    });

    await expect(run).rejects.toBe(failure);
  });

  it("should always keep exactly the rows at or after the cutoff when it drains", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ max: 10 * DAY_MS, min: -10 * DAY_MS })),
        fc.integer({ max: 5, min: 1 }),
        async (offsets, batchSize) => {
          const values = offsets.map(
            (offset) => new Date(NOW.getTime() + offset)
          );

          const store = fakeStore({ session: values });
          const cutoff = Number(cutoffOf(RETENTION.session, NOW));
          const kept = values.filter((value) => value.getTime() >= cutoff);

          const results = await purgeExpired({
            batchSize,
            deleteBatch: store.deleteBatch,
            maxBatches: values.length + 1,
            now: NOW,
          });

          expect(store.rows("session")).toStrictEqual(kept);
          expect(resultFor(results, "session")).toStrictEqual({
            deleted: values.length - kept.length,
            drained: true,
            table: "session",
          });
        }
      )
    );
  });

  it("should never delete more rows in one run than the batch bound", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 60 }),
        fc.integer({ max: 5, min: 1 }),
        fc.integer({ max: 5, min: 1 }),
        async (count, batchSize, maxBatches) => {
          const store = fakeStore({
            session: Array.from({ length: count }, () => daysBefore(3)),
          });

          const results = await purgeExpired({
            batchSize,
            deleteBatch: store.deleteBatch,
            maxBatches,
            now: NOW,
          });

          expect(resultFor(results, "session")?.deleted).toBe(
            Math.min(count, batchSize * maxBatches)
          );
        }
      )
    );
  });
});
