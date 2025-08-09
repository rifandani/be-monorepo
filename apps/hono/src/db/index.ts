import { drizzle } from 'drizzle-orm/node-postgres';
import { ENV } from '@/core/constants/env.js';

export const db = drizzle({
  connection: {
    connectionString: ENV.DATABASE_URL,
  },
  casing: 'snake_case',
});
