import { getTableName } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  rateLimitTable,
  sessionTable,
  verificationTable,
} from "#server/db/schema.ts";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const PURGE_BATCH_SIZE = 1000;
const PURGE_MAX_BATCHES = 100;

export interface Expiry {
  readonly afterMs: number;
  readonly clock: "date" | "epoch-ms";
  readonly column: PgColumn;
  readonly key: PgColumn;
  readonly table: PgTable;
}

export type Retention = "keep" | Expiry;

export const RETENTION = {
  account: "keep",
  rate_limit: {
    afterMs: DAY_MS,
    clock: "epoch-ms",
    column: rateLimitTable.lastRequest,
    key: rateLimitTable.id,
    table: rateLimitTable,
  },
  session: {
    afterMs: DAY_MS,
    clock: "date",
    column: sessionTable.expiresAt,
    key: sessionTable.id,
    table: sessionTable,
  },
  user: "keep",
  verification: {
    afterMs: HOUR_MS,
    clock: "date",
    column: verificationTable.expiresAt,
    key: verificationTable.id,
    table: verificationTable,
  },
} as const satisfies Record<string, Retention>;

export const cutoffOf = (expiry: Expiry, now: Date): Date | number => {
  const cutoff = now.getTime() - expiry.afterMs;

  return expiry.clock === "date" ? new Date(cutoff) : cutoff;
};

export type DeleteBatch = (
  expiry: Expiry,
  cutoff: Date | number,
  limit: number
) => Promise<number>;

export interface PurgeResult {
  readonly deleted: number;
  readonly drained: boolean;
  readonly table: string;
}

interface PurgeOptions {
  readonly batchSize?: number;
  readonly deleteBatch: DeleteBatch;
  readonly maxBatches?: number;
  readonly now: Date;
}

const purgeTable = async (
  expiry: Expiry,
  { batchSize, deleteBatch, maxBatches, now }: Required<PurgeOptions>
): Promise<PurgeResult> => {
  const cutoff = cutoffOf(expiry, now);
  const table = getTableName(expiry.table);
  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the next batch runs only when this batch was full
    const count = await deleteBatch(expiry, cutoff, batchSize);
    deleted += count;

    if (count < batchSize) {
      return { deleted, drained: true, table };
    }
  }

  return { deleted, drained: false, table };
};

const expiries = Object.values<Retention>(RETENTION).filter(
  (retention): retention is Expiry => retention !== "keep"
);

export const purgeExpired = async ({
  batchSize = PURGE_BATCH_SIZE,
  deleteBatch,
  maxBatches = PURGE_MAX_BATCHES,
  now,
}: PurgeOptions): Promise<PurgeResult[]> => {
  const results: PurgeResult[] = [];

  for (const expiry of expiries) {
    results.push(
      // oxlint-disable-next-line no-await-in-loop -- one table at a time keeps the load on the database low
      await purgeTable(expiry, { batchSize, deleteBatch, maxBatches, now })
    );
  }

  return results;
};
