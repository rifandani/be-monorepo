import { nextWindow } from "./store.ts";
import type { RateLimitStorage, WindowState } from "./store.ts";

/**
 * A {@link RateLimitStorage} that keeps window states in a `Map`. Tests use it.
 *
 * `hit` has no `await` between the read and the write, so two calls at the same
 * time cannot lose a hit.
 */
export class MemoryRateLimitStorage implements RateLimitStorage {
  readonly #windows = new Map<string, WindowState>();

  async deleteAll(keyPrefix: string): Promise<void> {
    for (const key of this.#windows.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.#windows.delete(key);
      }
    }

    await Promise.resolve();
  }

  async deleteKey(key: string): Promise<void> {
    this.#windows.delete(key);

    await Promise.resolve();
  }

  async decrement(key: string): Promise<void> {
    const window = this.#windows.get(key);

    if (window !== undefined) {
      this.#windows.set(key, {
        count: Math.max(0, window.count - 1),
        windowStart: window.windowStart,
      });
    }

    await Promise.resolve();
  }

  async hit(key: string, now: number, windowMs: number): Promise<WindowState> {
    const next = nextWindow(this.#windows.get(key), now, windowMs);

    this.#windows.set(key, next);

    return next;
  }

  async peek(key: string): Promise<WindowState | undefined> {
    return this.#windows.get(key);
  }
}
