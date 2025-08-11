import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { openAPI } from 'better-auth/plugins';
import { ENV } from '@/core/constants/env.js';
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
    },
  }),
  trustedOrigins: [ENV.APP_URL],
  emailAndPassword: { enabled: true },
  plugins: [
    openAPI({
      path: '/docs', // at /api/auth/docs
    }),
  ],
});
