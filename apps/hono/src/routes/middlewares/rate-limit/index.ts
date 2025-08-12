import { rateLimiter } from 'hono-rate-limiter';
import type { Variables } from '@/core/types/hono.js';
import {
  getClientIpAddress,
  getClientIpAddressFromContext,
} from '@/core/utils/net.js';
import { DbStore } from './store.js';

/**
 * rate limit middleware using drizzle postgres store with default rate limit of 10 req/s
 */
export const rateLimit = rateLimiter<{
  Variables: Variables;
}>({
  windowMs: 15 * 1000, // 15 seconds
  limit: 1 * 15, // Limit each IP to 150 requests per 15 seconds (10 req/s average)
  standardHeaders: 'draft-6', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  keyGenerator: async (c) => {
    // for authenticated users, use session id
    const session = c.get('session');
    if (session) {
      return `session:${session.id}`;
    }

    // get IP address from headers (most common)
    const ipAddressFromHeaders = getClientIpAddress(c.req.raw.headers);

    // fallback to IP address from context (less common)
    const ipAddressFromContext = await getClientIpAddressFromContext(c);

    return `ip:${ipAddressFromHeaders || ipAddressFromContext || 'anonymous'}`;
  },
  message: (c) => {
    const session = c.get('session');

    return session
      ? 'Rate limit exceeded for your account. Please try again later.'
      : 'Rate limit exceeded. Please try again later.';
  },
  // drizzle postgres store
  store: new DbStore(),
});
