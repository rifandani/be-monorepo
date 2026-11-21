import { rateLimiter } from "hono-rate-limiter";

import { resolveClientAddress } from "#server/client-address.ts";
import type { Variables } from "#server/types/hono.ts";

import { PostgresRateLimitStorage } from "./postgres-storage.ts";
import { RateLimitStore } from "./store.ts";

const RATE_LIMIT_WINDOW_MS = 15_000;
const RATE_LIMIT_LIMIT = 15;

export const rateLimit = rateLimiter<{
  Variables: Variables;
}>({
  keyGenerator: async (c) => {
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
  standardHeaders: "draft-6",
  store: new RateLimitStore({ storage: new PostgresRateLimitStorage() }),
  windowMs: RATE_LIMIT_WINDOW_MS,
});
