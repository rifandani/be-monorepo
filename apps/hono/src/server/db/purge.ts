import { inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { log } from "evlog";
import { Pool } from "pg";

import type { DeleteBatch } from "#server/retention.ts";
import { purgeExpired } from "#server/retention.ts";
import { messageOf } from "#shared/utils/message-of.ts";

const PURGE_CONNECT_TIMEOUT_MS = 10_000;
const PURGE_STATEMENT_TIMEOUT_MS = 30_000;

const main = async () => {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: PURGE_CONNECT_TIMEOUT_MS,
    max: 1,
    statement_timeout: PURGE_STATEMENT_TIMEOUT_MS,
  });

  const db = drizzle({ casing: "snake_case", client: pool });

  const deleteBatch: DeleteBatch = async (expiry, cutoff, limit) => {
    const expired = db
      .select({ key: expiry.key })
      .from(expiry.table)
      .where(lt(expiry.column, cutoff))
      .limit(limit);

    const result = await db
      .delete(expiry.table)
      .where(inArray(expiry.key, expired));

    return result.rowCount ?? 0;
  };

  try {
    const results = await purgeExpired({ deleteBatch, now: new Date() });

    for (const result of results) {
      log.info("db-purge", JSON.stringify(result));
    }
  } finally {
    await pool.end();
  }
};

try {
  await main();
} catch (error: unknown) {
  log.error("db-purge", messageOf(error));
  process.exit(1);
}
