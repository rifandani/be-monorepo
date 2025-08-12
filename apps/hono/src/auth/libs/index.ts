import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { openAPI } from 'better-auth/plugins';
import { ENV } from '@/core/constants/env.js';
import { ipAddressHeaders } from '@/core/utils/net.js';
import { db } from '@/db/index.js';
import * as schema from '@/db/schema.js';

export const auth = betterAuth({
  appName: ENV.APP_TITLE,
  secret: ENV.BETTER_AUTH_SECRET,
  baseURL: ENV.APP_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.userTable,
      session: schema.sessionTable,
      account: schema.accountTable,
      verification: schema.verificationTable,
      rate_limit: schema.rateLimitTable,
    },
  }),
  trustedOrigins: [ENV.APP_URL],
  emailAndPassword: { enabled: true },
  /**
   * server-side requests made using `auth.api` aren't affected by rate limiting.
   * rate limits only apply to client-initiated requests.
   *
   * @see https://better-auth.com/docs/concepts/rate-limit
   */
  rateLimit: {
    // enabled: true, // by default disabled in development mode
    window: 15, // time window in seconds
    max: 10 * 15, // max requests in the window (10 req/s)
    storage: 'database',
    modelName: 'rate_limit', // optional, by default "rateLimit" is used
  },
  plugins: [
    openAPI({
      path: '/docs', // at /api/auth/docs
    }),
  ],
  advanced: {
    ipAddress: {
      // request headers to check for IP address
      ipAddressHeaders: Object.values(ipAddressHeaders),
    },
  },
  telemetry: {
    enabled: false,
  },
});
