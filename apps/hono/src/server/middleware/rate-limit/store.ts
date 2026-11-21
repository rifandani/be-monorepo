import { log } from "evlog";
import type { ClientRateLimitInfo, Store } from "hono-rate-limiter";

const LOG_TAG = "rate-limit-store";

export const RATE_LIMIT_KEY_PREFIX = "hono-rate-limit:";

export interface WindowState {
  count: number;
  windowStart: number;
}

export interface RateLimitStorage {
  deleteAll: (keyPrefix: string) => Promise<void>;

  deleteKey: (key: string) => Promise<void>;

  decrement: (key: string) => Promise<void>;

  hit: (key: string, now: number, windowMs: number) => Promise<WindowState>;

  peek: (key: string) => Promise<WindowState | undefined>;
}

export const nextWindow = (
  current: WindowState | undefined,
  now: number,
  windowMs: number
): WindowState =>
  current === undefined || now >= current.windowStart + windowMs
    ? { count: 1, windowStart: now }
    : { count: current.count + 1, windowStart: current.windowStart };

// oxlint-disable-next-line anti-slop/no-unknown-parameters
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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

const toInfo = (
  window: WindowState,
  windowMs: number
): ClientRateLimitInfo => ({
  resetTime: new Date(window.windowStart + windowMs),
  totalHits: window.count,
});

export interface RateLimitStoreOptions {
  now?: () => number;
  storage: RateLimitStorage;
}

export class RateLimitStore implements Store {
  #windowMs: number | undefined;
  readonly #now: () => number;
  readonly #storage: RateLimitStorage;

  constructor({ now = Date.now, storage }: RateLimitStoreOptions) {
    this.#now = now;
    this.#storage = storage;
  }

  init(options: { windowMs: number }): void {
    this.#windowMs = options.windowMs;
  }

  #requireWindowMs(): number {
    if (this.#windowMs === undefined) {
      throw new Error("RateLimitStore: call init() before using the store");
    }

    return this.#windowMs;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const windowMs = this.#requireWindowMs();

    return safely("get", undefined, async () => {
      const window = await this.#storage.peek(RATE_LIMIT_KEY_PREFIX + key);

      return window === undefined ||
        this.#now() >= window.windowStart + windowMs
        ? undefined
        : toInfo(window, windowMs);
    });
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const windowMs = this.#requireWindowMs();
    const now = this.#now();

    return safely(
      "increment",
      toInfo({ count: 1, windowStart: now }, windowMs),
      async () =>
        toInfo(
          await this.#storage.hit(RATE_LIMIT_KEY_PREFIX + key, now, windowMs),
          windowMs
        )
    );
  }

  async decrement(key: string): Promise<void> {
    await safely("decrement", undefined, async () =>
      this.#storage.decrement(RATE_LIMIT_KEY_PREFIX + key)
    );
  }

  async resetKey(key: string): Promise<void> {
    await safely("resetKey", undefined, async () =>
      this.#storage.deleteKey(RATE_LIMIT_KEY_PREFIX + key)
    );
  }

  async resetAll(): Promise<void> {
    await safely("resetAll", undefined, async () =>
      this.#storage.deleteAll(RATE_LIMIT_KEY_PREFIX)
    );
  }
}
