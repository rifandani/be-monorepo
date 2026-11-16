import { log } from "evlog";
import type { ClientRateLimitInfo, Store } from "hono-rate-limiter";

/**
 * The tag every failure in this store is logged under. `hono-rate-limiter` hands
 * its `Store` only a key, never the hono context, so `c.get("log")` is out of
 * reach. These go to evlog's process-level logger instead, the same one
 * `node.ts` uses for startup and shutdown, and they do not reach the OTLP drain.
 */
const LOG_TAG = "rate-limit-store";

/**
 * Every key this store writes starts with this prefix. Better Auth keeps its own
 * rows in the same `rate_limit` table, so the prefix keeps the two apart.
 * `resetAll` removes only keys that start with it.
 */
export const RATE_LIMIT_KEY_PREFIX = "hono-rate-limit:";

/**
 * The state of one fixed window.
 */
export interface WindowState {
  /** Hits counted in this window. */
  count: number;
  /** Time of the first hit of this window, in milliseconds since the epoch. */
  windowStart: number;
}

/**
 * The seam of the store. An adapter keeps the {@link WindowState} for each key.
 *
 * Every method gets a key that already has the namespace prefix. An adapter
 * must not change a key.
 */
export interface RateLimitStorage {
  /**
   * Deletes the state of every key that starts with `keyPrefix`.
   */
  deleteAll: (keyPrefix: string) => Promise<void>;

  /**
   * Deletes the state of one key.
   */
  deleteKey: (key: string) => Promise<void>;

  /**
   * Removes one hit from the window of `key`. The count never goes below zero.
   * The window start does not change. A key with no state stays without state.
   */
  decrement: (key: string) => Promise<void>;

  /**
   * Counts one hit at `now`, as one atomic step. Two calls at the same time must
   * not lose a hit. The result must be the one that {@link nextWindow} gives.
   */
  hit: (key: string, now: number, windowMs: number) => Promise<WindowState>;

  /**
   * The stored state of `key`, or `undefined` when the key has no state. This
   * can be a window that is already over: the caller checks.
   */
  peek: (key: string) => Promise<WindowState | undefined>;
}

/**
 * The fixed-window rule. A window starts at its first hit and ends at
 * `windowStart + windowMs`. At that time, or later, the next hit starts a new
 * window. Hits in a window never move its start.
 *
 * Every adapter implements this rule. The in-memory adapter calls it. The
 * Postgres adapter writes the same rule in SQL.
 */
export const nextWindow = (
  current: WindowState | undefined,
  now: number,
  windowMs: number
): WindowState =>
  current === undefined || now >= current.windowStart + windowMs
    ? { count: 1, windowStart: now }
    : { count: current.count + 1, windowStart: current.windowStart };

// A `catch` binding is `unknown` by TypeScript's own design and there is no
// boundary schema to parse it with — narrowing it here IS the parse step, and it
// is the same one `node.ts` performs inline at its two catch sites.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs one storage call. On failure it logs and returns `fallback`.
 */
const safely = async <T>(
  operation: string,
  fallback: T,
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    log.error(LOG_TAG, `${operation} failed: ${reason(error)}`);

    return fallback;
  }
};

/**
 * The hit count and reset time of a window.
 */
const toInfo = (
  window: WindowState,
  windowMs: number
): ClientRateLimitInfo => ({
  resetTime: new Date(window.windowStart + windowMs),
  totalHits: window.count,
});

export interface RateLimitStoreOptions {
  /**
   * The clock, in milliseconds since the epoch. Tests replace it.
   *
   * @default Date.now
   */
  now?: () => number;
  /** Where the window states live. */
  storage: RateLimitStorage;
}

/**
 * A `hono-rate-limiter` store with a fixed window for each key.
 *
 * - A window starts at its first hit and ends `windowMs` later. Steady traffic
 *   does not extend it.
 * - `get` and `increment` report the same reset time: `windowStart + windowMs`.
 * - The store fails open. If the storage throws, the store logs the error and
 *   lets the request through.
 *
 * `windowMs` comes from `init`, which `hono-rate-limiter` calls once. Call
 * `init` before `increment` or `get`.
 *
 * @public
 */
export class RateLimitStore implements Store {
  #windowMs: number | undefined;
  readonly #now: () => number;
  readonly #storage: RateLimitStorage;

  constructor({ now = Date.now, storage }: RateLimitStoreOptions) {
    this.#now = now;
    this.#storage = storage;
  }

  /**
   * Reads the window length from the middleware options.
   */
  init(options: { windowMs: number }): void {
    this.#windowMs = options.windowMs;
  }

  /**
   * The window length. It fails when `init` has not run: that is a setup error.
   */
  #requireWindowMs(): number {
    if (this.#windowMs === undefined) {
      throw new Error("RateLimitStore: call init() before using the store");
    }

    return this.#windowMs;
  }

  /**
   * The hit count and reset time of a client. It returns `undefined` when the
   * client has no window, or when its window is over.
   */
  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const windowMs = this.#requireWindowMs();

    return safely("get", undefined, async () => {
      const window = await this.#storage.peek(RATE_LIMIT_KEY_PREFIX + key);

      // `get` only reads. An old window is replaced by the next `increment`.
      return window === undefined ||
        this.#now() >= window.windowStart + windowMs
        ? undefined
        : toInfo(window, windowMs);
    });
  }

  /**
   * Counts one hit for a client.
   */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const windowMs = this.#requireWindowMs();
    const now = this.#now();

    return safely(
      "increment",
      // Fail open: report one hit in a window that starts now.
      toInfo({ count: 1, windowStart: now }, windowMs),
      async () =>
        toInfo(
          await this.#storage.hit(RATE_LIMIT_KEY_PREFIX + key, now, windowMs),
          windowMs
        )
    );
  }

  /**
   * Removes one hit from a client. The window does not change.
   */
  async decrement(key: string): Promise<void> {
    await safely("decrement", undefined, async () =>
      this.#storage.decrement(RATE_LIMIT_KEY_PREFIX + key)
    );
  }

  /**
   * Resets the window of one client.
   */
  async resetKey(key: string): Promise<void> {
    await safely("resetKey", undefined, async () =>
      this.#storage.deleteKey(RATE_LIMIT_KEY_PREFIX + key)
    );
  }

  /**
   * Resets the window of every client of this store. Keys of other owners, such
   * as Better Auth, stay.
   */
  async resetAll(): Promise<void> {
    await safely("resetAll", undefined, async () =>
      this.#storage.deleteAll(RATE_LIMIT_KEY_PREFIX)
    );
  }
}
