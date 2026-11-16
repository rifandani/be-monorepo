import { eq, sql } from "drizzle-orm";

import { db } from "#server/db/index.ts";
import { rateLimitTable } from "#server/db/schema.ts";

import type { RateLimitStorage, WindowState } from "./store.ts";

/**
 * A {@link RateLimitStorage} in the `rate_limit` table.
 *
 * The table has no column for a window start, and a schema change is out of
 * scope. For the rows of this store, the `last_request` column holds the WINDOW
 * START: the time of the first hit of the window. Better Auth uses the same
 * table, and its rows keep the original meaning ("time of the last request").
 * This adapter reads and writes only rows with its own key prefix.
 *
 * Not covered by unit tests: it needs a Postgres database. See ADR-0001.
 *
 * @public
 */
export class PostgresRateLimitStorage implements RateLimitStorage {
  readonly #db: typeof db;

  constructor(database: typeof db = db) {
    this.#db = database;
  }

  async deleteAll(keyPrefix: string): Promise<void> {
    // `starts_with` is a plain prefix match: `%` and `_` in the prefix are safe.
    await this.#db
      .delete(rateLimitTable)
      .where(sql`starts_with(${rateLimitTable.key}, ${keyPrefix})`);
  }

  async deleteKey(key: string): Promise<void> {
    await this.#db.delete(rateLimitTable).where(eq(rateLimitTable.key, key));
  }

  async decrement(key: string): Promise<void> {
    // The window start (`last_request`) stays as it is.
    await this.#db
      .update(rateLimitTable)
      .set({ count: sql`GREATEST(0, ${rateLimitTable.count} - 1)` })
      .where(eq(rateLimitTable.key, key));
  }

  /**
   * One atomic upsert. The `SET` expressions read the OLD row, so both
   * `CASE` branches see the same window. The row lock of `ON CONFLICT` makes
   * two hits at the same time count one after the other.
   */
  async hit(key: string, now: number, windowMs: number): Promise<WindowState> {
    const windowOver = sql`${now}::bigint >= ${rateLimitTable.lastRequest} + ${windowMs}::bigint`;

    const [row] = await this.#db
      .insert(rateLimitTable)
      .values({ count: 1, key, lastRequest: now })
      .onConflictDoUpdate({
        set: {
          count: sql`CASE WHEN ${windowOver} THEN 1 ELSE ${rateLimitTable.count} + 1 END`,
          lastRequest: sql`CASE WHEN ${windowOver} THEN ${now}::bigint ELSE ${rateLimitTable.lastRequest} END`,
        },
        target: rateLimitTable.key,
      })
      .returning({
        count: rateLimitTable.count,
        windowStart: rateLimitTable.lastRequest,
      });

    if (row === undefined) {
      throw new Error("rate_limit upsert returned no row");
    }

    return row;
  }

  async peek(key: string): Promise<WindowState | undefined> {
    const [row] = await this.#db
      .select({
        count: rateLimitTable.count,
        windowStart: rateLimitTable.lastRequest,
      })
      .from(rateLimitTable)
      .where(eq(rateLimitTable.key, key))
      .limit(1);

    return row;
  }
}
