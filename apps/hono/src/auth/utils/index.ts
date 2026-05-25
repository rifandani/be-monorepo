import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, openAPI } from "better-auth/plugins";

import { ENV } from "@/core/constants/env.js";
import { ipAddressHeaders } from "@/core/utils/net.js";
import { db } from "@/db/index.js";
import * as schema from "@/db/schema.js";

const RATE_LIMIT_WINDOW_SECONDS = 15; // 15 seconds
const RATE_LIMIT_MAX_REQUESTS = 10 * RATE_LIMIT_WINDOW_SECONDS; // 10 req/s

export const auth = betterAuth({
  advanced: {
    ipAddress: {
      // request headers to check for IP address
      ipAddressHeaders: Object.values(ipAddressHeaders),
    },
  },
  appName: ENV.APP_TITLE,
  baseURL: ENV.APP_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      account: schema.accountTable,
      rate_limit: schema.rateLimitTable,
      session: schema.sessionTable,
      user: schema.userTable,
      verification: schema.verificationTable,
    },
  }),
  emailAndPassword: { enabled: true },
  plugins: [
    bearer(), // enables authentication using Bearer tokens as an alternative to browser cookies
    openAPI({
      path: "/docs", // at /api/auth/docs
      theme: "bluePlanet",
    }),
  ],
  /**
   * server-side requests made using `auth.api` aren't affected by rate limiting.
   * rate limits only apply to client-initiated requests.
   *
   * @see https://better-auth.com/docs/concepts/rate-limit
   */
  rateLimit: {
    // enabled: true, // by default disabled in development mode
    max: RATE_LIMIT_MAX_REQUESTS, // max requests in the window (10 req/s)
    modelName: "rate_limit", // optional, by default "rateLimit" is used
    storage: "database",
    window: RATE_LIMIT_WINDOW_SECONDS, // time window in seconds
  },
  secret: ENV.BETTER_AUTH_SECRET,
  telemetry: {
    enabled: false,
  },
  trustedOrigins: [ENV.APP_URL],
});
