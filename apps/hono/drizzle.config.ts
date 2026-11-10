import { defineConfig } from "drizzle-kit";

if (
  process.env.DATABASE_URL === undefined ||
  process.env.DATABASE_URL.length === 0
) {
  throw new Error("DATABASE_URL is not set");
}

// config for drizzle-kit
export default defineConfig({
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  dialect: "postgresql",
  out: "./src/server/db/migrations",
  schema: "./src/server/db/schema.ts",
});
