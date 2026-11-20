import * as fc from "fast-check";
import type { ClientRateLimitInfo } from "hono-rate-limiter";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryRateLimitStorage } from "./memory-storage.ts";
import { nextWindow, RATE_LIMIT_KEY_PREFIX, RateLimitStore } from "./store.ts";
import type { RateLimitStorage } from "./store.ts";

const WINDOW_MS = 1000;
const START = 1_000_000;

type Pending = Promise<ClientRateLimitInfo | undefined>;

/** The hit count of a result. */
const hits = async (pending: Pending) => {
  const info = await pending;

  return info?.totalHits;
};

/** The reset time of a result, in milliseconds since the epoch. */
const resetMs = async (pending: Pending) => {
  const info = await pending;

  return info?.resetTime?.getTime();
};

const failing = (failure: unknown): RateLimitStorage => {
  const fail = vi.fn<() => Promise<never>>().mockRejectedValue(failure);

  return {
    decrement: fail,
    deleteAll: fail,
    deleteKey: fail,
    hit: fail,
    peek: fail,
  };
};

const setupFailing = (failure: unknown) => {
  // evlog prints through the console; the failure is expected here.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  const store = new RateLimitStore({
    now: () => START,
    storage: failing(failure),
  });

  store.init({ windowMs: WINDOW_MS });

  return store;
};

/**
 * A store over the in-memory adapter and a clock that the test moves by hand.
 */
const setup = (
  storage: RateLimitStorage = new MemoryRateLimitStorage(),
  windowMs = WINDOW_MS
) => {
  let current = START;
  const store = new RateLimitStore({ now: () => current, storage });
  store.init({ windowMs });

  return {
    advance: (ms: number) => {
      current += ms;
    },
    storage,
    store,
  };
};

/** Any stored window. */
const windowState = () =>
  fc.record({ count: fc.nat(), windowStart: fc.integer() });

/** How many times `key` occurs in `keys`. */
const countOf = (keys: readonly string[], key: string) =>
  keys.filter((candidate) => candidate === key).length;

/** The reset time of a result, in milliseconds since the epoch. */
const resetOf = (info: ClientRateLimitInfo) => info.resetTime?.getTime() ?? 0;

/** True when two results report the same window. */
const sameWindow = (left: ClientRateLimitInfo, right: ClientRateLimitInfo) =>
  resetOf(left) === resetOf(right);

/**
 * The in-memory adapter, with each `hit` held until the scheduler lets it run.
 * The scheduler picks the order, so concurrent hits run in every order.
 */
const scheduledStorage = (s: fc.Scheduler): RateLimitStorage => {
  const inner = new MemoryRateLimitStorage();

  return {
    decrement: async (key) => inner.decrement(key),
    deleteAll: async (keyPrefix) => inner.deleteAll(keyPrefix),
    deleteKey: async (key) => inner.deleteKey(key),
    hit: async (key, now, windowMs) => {
      await s.schedule(Promise.resolve());

      return inner.hit(key, now, windowMs);
    },
    peek: async (key) => inner.peek(key),
  };
};

describe(RateLimitStore, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fixed window", () => {
    it("counts hits in one window", async () => {
      const { advance, store } = setup();

      await expect(hits(store.increment("a"))).resolves.toBe(1);
      advance(100);
      await expect(hits(store.increment("a"))).resolves.toBe(2);
      advance(100);
      await expect(hits(store.increment("a"))).resolves.toBe(3);
    });

    it("keeps separate windows for separate keys", async () => {
      const { store } = setup();

      await store.increment("a");
      await store.increment("a");

      await expect(hits(store.increment("b"))).resolves.toBe(1);
    });

    it("resets after windowMs from the first hit, even with steady traffic", async () => {
      const { advance, store } = setup();

      // A hit every 400 ms. A sliding window would never reset.
      const firstReset = await resetMs(store.increment("a"));
      advance(400);
      await store.increment("a");
      advance(400);
      const third = store.increment("a");

      await expect(hits(third)).resolves.toBe(3);
      await expect(resetMs(third)).resolves.toBe(firstReset);

      advance(199); // 999 ms after the first hit: the window is still open

      await expect(hits(store.increment("a"))).resolves.toBe(4);

      advance(1); // 1000 ms after the first hit: the window is over
      const next = store.increment("a");

      await expect(hits(next)).resolves.toBe(1);
      await expect(resetMs(next)).resolves.toBe(START + 2 * WINDOW_MS);
    });

    it("starts the next window at the first hit after the old one", async () => {
      const { advance, store } = setup();

      await store.increment("a");
      advance(5000); // long after the window ended

      const next = store.increment("a");

      await expect(hits(next)).resolves.toBe(1);
      await expect(resetMs(next)).resolves.toBe(START + 5000 + WINDOW_MS);
    });

    it("reports get and increment with the same reset time", async () => {
      const { advance, store } = setup();

      const hit = await store.increment("a");
      advance(300);
      const read = await store.get("a");

      expect(read).toStrictEqual(hit);
      expect(hit.resetTime?.getTime()).toBe(START + WINDOW_MS);

      advance(300);
      const again = await store.increment("a");

      expect(again.resetTime).toStrictEqual(hit.resetTime);
      await expect(store.get("a")).resolves.toStrictEqual(again);
    });

    it("returns undefined from get for an unknown key", async () => {
      const { store } = setup();

      await expect(store.get("missing")).resolves.toBeUndefined();
    });

    it("returns undefined from get once the window is over", async () => {
      const { advance, store } = setup();

      await store.increment("a");
      advance(WINDOW_MS - 1);

      await expect(store.get("a")).resolves.toBeDefined();

      advance(1);

      await expect(store.get("a")).resolves.toBeUndefined();
    });

    it("does not lose a hit when get runs on an old window", async () => {
      const { advance, store } = setup();

      await store.increment("a");
      advance(WINDOW_MS);
      await store.get("a");

      await expect(hits(store.increment("a"))).resolves.toBe(1);
      await expect(hits(store.increment("a"))).resolves.toBe(2);
    });
  });

  describe("concurrency", () => {
    it("counts concurrent first hits of a new key", async () => {
      const { store } = setup();
      const total = 20;

      // No `await` between the calls: all of them start before any one ends.
      const pending: ReturnType<typeof store.increment>[] = [];

      for (let call = 0; call < total; call += 1) {
        pending.push(store.increment("new"));
      }

      const results = await Promise.all(pending);
      const counts = results.map((result) => result.totalHits);

      expect(counts.toSorted((a, b) => a - b)).toStrictEqual(
        Array.from({ length: total }, (_, i) => i + 1)
      );
      await expect(hits(store.get("new"))).resolves.toBe(total);
    });

    it("should never lose a hit, whatever order the storage calls run in", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.scheduler(),
          fc.array(fc.constantFrom("a", "b")),
          async (s, keys) => {
            // Arrange
            const { store } = setup(scheduledStorage(s));

            // Act
            await s.waitFor(
              Promise.all(keys.map(async (key) => store.increment(key)))
            );

            // Assert
            await expect(hits(store.get("a"))).resolves.toBe(
              countOf(keys, "a") || undefined
            );
            await expect(hits(store.get("b"))).resolves.toBe(
              countOf(keys, "b") || undefined
            );
          }
        )
      );
    });
  });

  it("should always count up by one in a window and restart at one once it ends", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1 }),
        fc.array(fc.nat()),
        async (windowMs, gaps) => {
          // Arrange
          const { advance, store } = setup(
            new MemoryRateLimitStorage(),
            windowMs
          );

          let previous = await store.increment("a");
          let elapsed = 0;

          for (const gap of gaps) {
            advance(gap);
            elapsed += gap;

            // Act
            // Each hit must see the clock after the previous hit.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const current = await store.increment("a");

            // Assert
            const open = START + elapsed < resetOf(previous);

            expect(sameWindow(previous, current)).toBe(open);
            expect(current.totalHits).toBe(open ? previous.totalHits + 1 : 1);
            previous = current;
          }
        }
      )
    );
  });

  describe("decrement", () => {
    it("removes one hit and keeps the window", async () => {
      const { advance, store } = setup();

      const firstReset = await resetMs(store.increment("a"));
      await store.increment("a");
      advance(500);
      await store.decrement("a");

      const read = store.get("a");

      await expect(hits(read)).resolves.toBe(1);
      await expect(resetMs(read)).resolves.toBe(firstReset);

      // The window still ends 1000 ms after the first hit.
      advance(500);

      await expect(hits(store.increment("a"))).resolves.toBe(1);
    });

    it("does not go below zero", async () => {
      const { store } = setup();

      await store.increment("a");
      await store.decrement("a");
      await store.decrement("a");

      await expect(hits(store.get("a"))).resolves.toBe(0);
      await expect(hits(store.increment("a"))).resolves.toBe(1);
    });

    it("ignores a key with no window", async () => {
      const { store } = setup();

      await store.decrement("missing");

      await expect(store.get("missing")).resolves.toBeUndefined();
    });
  });

  describe("resetKey", () => {
    it("removes the window of one key only", async () => {
      const { store } = setup();

      await store.increment("a");
      await store.increment("b");
      await store.resetKey("a");

      await expect(store.get("a")).resolves.toBeUndefined();
      await expect(hits(store.get("b"))).resolves.toBe(1);
      await expect(hits(store.increment("a"))).resolves.toBe(1);
    });
  });

  describe("namespace", () => {
    it("writes every key under the prefix", async () => {
      const { storage, store } = setup();

      await store.increment("ip:1.2.3.4");

      await expect(
        storage.peek(`${RATE_LIMIT_KEY_PREFIX}ip:1.2.3.4`)
      ).resolves.toStrictEqual({ count: 1, windowStart: START });
      await expect(storage.peek("ip:1.2.3.4")).resolves.toBeUndefined();
    });

    it("does not read, change or delete a key of another owner", async () => {
      const { storage, store } = setup();

      // Better Auth keeps keys such as `1.2.3.4/sign-in/email` in the same table.
      await storage.hit("1.2.3.4/sign-in/email", START, WINDOW_MS);

      await expect(store.get("1.2.3.4/sign-in/email")).resolves.toBeUndefined();

      await store.decrement("1.2.3.4/sign-in/email");
      await store.resetKey("1.2.3.4/sign-in/email");

      await expect(
        storage.peek("1.2.3.4/sign-in/email")
      ).resolves.toStrictEqual({
        count: 1,
        windowStart: START,
      });
    });

    it("resetAll removes only keys of this store", async () => {
      const { storage, store } = setup();

      await store.increment("a");
      await store.increment("b");
      await storage.hit("1.2.3.4/sign-in/email", START, WINDOW_MS);
      await storage.hit("other-prefix:a", START, WINDOW_MS);

      await store.resetAll();

      await expect(store.get("a")).resolves.toBeUndefined();
      await expect(store.get("b")).resolves.toBeUndefined();
      await expect(
        storage.peek("1.2.3.4/sign-in/email")
      ).resolves.toBeDefined();
      await expect(storage.peek("other-prefix:a")).resolves.toBeDefined();
    });
  });

  describe("setup", () => {
    it("fails when init has not run", async () => {
      const store = new RateLimitStore({
        storage: new MemoryRateLimitStorage(),
      });

      await expect(store.increment("a")).rejects.toThrow(/init\(\)/u);
      await expect(store.get("a")).rejects.toThrow(/init\(\)/u);
    });

    it("uses the real clock by default", async () => {
      // Arrange
      const store = new RateLimitStore({
        storage: new MemoryRateLimitStorage(),
      });

      store.init({ windowMs: WINDOW_MS });

      const before = Date.now();

      // Act
      const reset = await resetMs(store.increment("a"));

      // Assert
      expect(reset).toBeGreaterThanOrEqual(before + WINDOW_MS);
      expect(reset).toBeLessThanOrEqual(Date.now() + WINDOW_MS);
    });
  });

  describe("storage failure", () => {
    it("lets the request through when increment fails", async () => {
      const store = setupFailing(new Error("db down"));

      await expect(store.increment("a")).resolves.toStrictEqual({
        resetTime: new Date(START + WINDOW_MS),
        totalHits: 1,
      });
    });

    it("returns undefined from get when storage fails", async () => {
      const store = setupFailing("not an Error");

      await expect(store.get("a")).resolves.toBeUndefined();
    });

    it("does not throw from decrement, resetKey or resetAll", async () => {
      const store = setupFailing(new Error("db down"));

      await expect(store.decrement("a")).resolves.toBeUndefined();
      await expect(store.resetKey("a")).resolves.toBeUndefined();
      await expect(store.resetAll()).resolves.toBeUndefined();
    });
  });
});

describe(nextWindow, () => {
  it("should always add one hit to a window that is still open", () => {
    fc.assert(
      fc.property(
        windowState(),
        fc.integer({ min: 1 }),
        fc.nat(),
        (current, windowMs, elapsed) => {
          // Arrange
          const now = current.windowStart + (elapsed % windowMs);

          // Act
          const next = nextWindow(current, now, windowMs);

          // Assert
          expect(next).toStrictEqual({
            count: current.count + 1,
            windowStart: current.windowStart,
          });
        }
      )
    );
  });

  it("should always start a new window at now once the old one is over", () => {
    fc.assert(
      fc.property(
        windowState(),
        fc.integer({ min: 1 }),
        fc.nat(),
        (current, windowMs, late) => {
          // Arrange
          const now = current.windowStart + windowMs + late;

          // Act
          const next = nextWindow(current, now, windowMs);

          // Assert
          expect(next).toStrictEqual({ count: 1, windowStart: now });
        }
      )
    );
  });
});
