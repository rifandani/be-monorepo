import { rateLimiter } from "hono-rate-limiter";

import { resolveClientAddress } from "#server/client-address.ts";
import type { Variables } from "#server/types/hono.ts";

import { PostgresRateLimitStorage } from "./postgres-storage.ts";
import { RateLimitStore } from "./store.ts";

const RATE_LIMIT_WINDOW_MS = 15_000; // 15 seconds
const RATE_LIMIT_LIMIT = 15; // Limit each IP to 150 requests per 15 seconds (10 req/s average)

/**
 * rate limit middleware using drizzle postgres store with default rate limit of 10 req/s
 */
export const rateLimit = rateLimiter<{
  Variables: Variables;
}>({
  keyGenerator: async (c) => {
    // for authenticated users, use session id
    const session = c.get("session");

    if (session) {
      return `session:${session.id}`;
    }

    return `ip:${await resolveClientAddress(c)}`;
  },
  limit: RATE_LIMIT_LIMIT,
  message: (c) => {
    const session = c.get("session");

    return session
      ? "Rate limit exceeded for your account. Please try again later."
      : "Rate limit exceeded. Please try again later.";
  },
  standardHeaders: "draft-6", // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  store: new RateLimitStore({ storage: new PostgresRateLimitStorage() }),
  windowMs: RATE_LIMIT_WINDOW_MS,
});
