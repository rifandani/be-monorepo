import { eq, sql } from "drizzle-orm";
import { log } from "evlog";
import type {
  ClientRateLimitInfo,
  HonoConfigType,
  Store,
  WSConfigType,
} from "hono-rate-limiter";
import type { Env, Input } from "hono/types";

/* oxlint-disable class-methods-use-this */
import { db } from "@/db/index.js";
import { rateLimitTable } from "@/db/schema.js";

/**
 * The tag every failure in this store is logged under. `DbStore` runs inside a
 * request but `hono-rate-limiter` hands its `Store` only a key, never the hono
 * context, so `c.get("log")` — the only way into the request's wide event, since
 * evlog's hono integration does not bind a logger through AsyncLocalStorage — is
 * out of reach. These go to evlog's process-level logger instead, the same one
 * `node.ts` uses for startup and shutdown, and they do not reach the OTLP drain.
 */
const LOG_TAG = "rate-limit-store";

// A `catch` binding is `unknown` by TypeScript's own design and there is no
// boundary schema to parse it with — narrowing it here IS the parse step, and it
// is the same one `node.ts` performs inline at its two catch sites.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * A `Store` that stores the hit count for each client in a PostgreSQL database.
 *
 * @public
 */
export class DbStore<
  E extends Env = Env,
  P extends string = string,
  I extends Input = Input,
> implements Store<E, P, I> {
  /**
   * The duration of time before which all hit counts are reset (in milliseconds).
   */
  #windowMs!: number;

  /**
   * Method that initializes the store.
   *
   * @param options {HonoConfigType | WSConfigType} - The options used to setup the middleware.
   */
  init(options: HonoConfigType<E, P, I> | WSConfigType<E, P, I>): void {
    // Get the duration of a window from the options.
    this.#windowMs = options.windowMs;
  }

  /**
   * The record for `key`, or `undefined` when the client has no record yet.
   */
  async #findRecord(key: string) {
    const [record] = await db
      .select()
      .from(rateLimitTable)
      .where(eq(rateLimitTable.key, key))
      .limit(1);

    return record;
  }

  /**
   * Whether `lastRequest` falls outside the current window. A missing
   * timestamp counts as within the window, matching the write path, which
   * always stamps one.
   */
  #isExpired(lastRequest: number | null, now: number): boolean {
    return lastRequest ? lastRequest < now - this.#windowMs : false;
  }

  /**
   * When the window holding `lastRequest` ends. A missing timestamp is read as
   * "just now", giving a full window.
   */
  #resetTime(lastRequest: number | null, now: number): Date {
    return new Date(now + this.#windowMs - (now - (lastRequest || now)));
  }

  /**
   * The hit count and window end a live record reports to the middleware.
   */
  #toRateLimitInfo(
    record: { count: number | null; lastRequest: number | null },
    now: number
  ): ClientRateLimitInfo {
    return {
      resetTime: this.#resetTime(record.lastRequest, now),
      totalHits: record.count ?? 0,
    };
  }

  /**
   * Method to fetch a client's hit count and reset time.
   *
   * @param key {string} - The identifier for a client.
   *
   * @returns {ClientRateLimitInfo | undefined} - The number of hits and reset time for that client.
   *
   * @public
   */
  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      const record = await this.#findRecord(key);
      const now = Date.now();

      if (!record) {
        return;
      }

      if (this.#isExpired(record.lastRequest, now)) {
        // Record is expired, drop it so the next hit starts a fresh window
        await db.delete(rateLimitTable).where(eq(rateLimitTable.key, key));
        return;
      }

      return this.#toRateLimitInfo(record, now);
    } catch (error) {
      log.error(LOG_TAG, `get failed: ${reason(error)}`);
    }
  }

  /**
   * The hit count `record` should carry after this request — a restart when its
   * window has already expired, one more otherwise.
   */
  #nextCount(
    record: { count: number | null; lastRequest: number | null },
    now: number
  ): number {
    return this.#isExpired(record.lastRequest, now)
      ? 1
      : (record.count ?? 0) + 1;
  }

  /**
   * Bumps an existing record's counter.
   *
   * @returns The stored hit count.
   */
  async #bumpRecord(
    record: { count: number | null; lastRequest: number | null },
    key: string,
    now: number
  ): Promise<number | null | undefined> {
    const [updated] = await db
      .update(rateLimitTable)
      .set({ count: this.#nextCount(record, now), lastRequest: now })
      .where(eq(rateLimitTable.key, key))
      .returning();

    return updated?.count;
  }

  /**
   * Creates the first record for a client (UUID is auto-generated).
   *
   * @returns The stored hit count.
   */
  async #createRecord(
    key: string,
    now: number
  ): Promise<number | null | undefined> {
    const [inserted] = await db
      .insert(rateLimitTable)
      .values({ count: 1, key, lastRequest: now })
      .returning();

    return inserted?.count;
  }

  /**
   * Method to increment a client's hit counter.
   *
   * @param key {string} - The identifier for a client.
   *
   * @returns {ClientRateLimitInfo} - The number of hits and reset time for that client.
   *
   * @public
   */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now();
    const resetTime = new Date(now + this.#windowMs);

    try {
      const record = await this.#findRecord(key);
      const totalHits = record
        ? await this.#bumpRecord(record, key, now)
        : await this.#createRecord(key, now);

      return { resetTime, totalHits: totalHits || 1 };
    } catch (error) {
      log.error(LOG_TAG, `increment failed: ${reason(error)}`);
      // Fallback: return a conservative estimate
      return { resetTime, totalHits: 1 };
    }
  }

  /**
   * Method to decrement a client's hit counter.
   *
   * @param key {string} - The identifier for a client.
   *
   * @public
   */
  async decrement(key: string): Promise<void> {
    try {
      const now = Date.now();
      await db
        .update(rateLimitTable)
        .set({
          count: sql`GREATEST(0, ${rateLimitTable.count} - 1)`, // prevent negative counts
          lastRequest: now,
        })
        .where(eq(rateLimitTable.key, key));
    } catch (error) {
      log.error(LOG_TAG, `decrement failed: ${reason(error)}`);
    }
  }

  /**
   * Method to reset a client's hit counter.
   *
   * @param key {string} - The identifier for a client.
   *
   * @public
   */
  async resetKey(key: string): Promise<void> {
    try {
      await db.delete(rateLimitTable).where(eq(rateLimitTable.key, key));
    } catch (error) {
      log.error(LOG_TAG, `resetKey failed: ${reason(error)}`);
    }
  }

  /**
   * Method to reset everyone's hit counter.
   *
   * @public
   */
  async resetAll(): Promise<void> {
    try {
      await db.delete(rateLimitTable);
    } catch (error) {
      log.error(LOG_TAG, `resetAll failed: ${reason(error)}`);
    }
  }

  /**
   * Method to stop the timer (if currently running) and prevent any memory
   * leaks. For DbStore, this is mostly a no-op but included for interface compatibility.
   *
   * @public
   */
  shutdown(): void {
    // No cleanup needed for database store
  }
}
