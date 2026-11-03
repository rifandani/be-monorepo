import { rateLimiter } from "hono-rate-limiter";

import type { Variables } from "#core/types/hono.ts";
import {
  getClientIpAddress,
  getClientIpAddressFromContext,
} from "#core/utils/net.ts";

import { DbStore } from "./store.ts";

const RATE_LIMIT_WINDOW_MS = 15_000; // 15 seconds
const RATE_LIMIT_LIMIT = 15; // Limit each IP to 150 requests per 15 seconds (10 req/s average)

const nonEmpty = (ip: string | null): string | null =>
  ip === null || ip.length === 0 ? null : ip;

/**
 * First non-empty address wins: headers, then request context, then `anonymous`.
 */
const resolveClientIp = (
  fromHeaders: string | null,
  fromContext: string | null
): string => nonEmpty(fromHeaders) ?? nonEmpty(fromContext) ?? "anonymous";

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

    // get IP address from headers (most common), then from context (less common)
    const ipAddress = resolveClientIp(
      getClientIpAddress(c.req.raw.headers),
      await getClientIpAddressFromContext(c)
    );

    return `ip:${ipAddress}`;
  },
  limit: RATE_LIMIT_LIMIT,
  message: (c) => {
    const session = c.get("session");

    return session
      ? "Rate limit exceeded for your account. Please try again later."
      : "Rate limit exceeded. Please try again later.";
  },
  standardHeaders: "draft-6", // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  store: new DbStore(),
  windowMs: RATE_LIMIT_WINDOW_MS,
});
