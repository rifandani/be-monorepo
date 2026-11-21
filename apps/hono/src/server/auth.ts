import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, openAPI } from "better-auth/plugins";

import { clientAddressHeaders } from "#server/client-address.ts";
import { db } from "#server/db/index.ts";
import * as schema from "#server/db/schema.ts";
import { ENV } from "#shared/constants/env.ts";

const RATE_LIMIT_WINDOW_SECONDS = 15;
const RATE_LIMIT_MAX_REQUESTS = 10 * RATE_LIMIT_WINDOW_SECONDS;

export const auth = betterAuth({
  advanced: {
    ipAddress: {
      ipAddressHeaders: [...clientAddressHeaders],
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
    bearer(),
    openAPI({
      path: "/docs",
      theme: "bluePlanet",
    }),
  ],
  rateLimit: {
    max: RATE_LIMIT_MAX_REQUESTS,
    modelName: "rate_limit",
    storage: "database",
    window: RATE_LIMIT_WINDOW_SECONDS,
  },
  secret: ENV.BETTER_AUTH_SECRET,
  telemetry: {
    enabled: false,
  },
  trustedOrigins: [ENV.APP_URL],
});
