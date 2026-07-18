import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "**/.agents",
    "**/.claude",
    "**/.cursor",
    "**/.repos",
    "**/docs",
    "apps/hono/src/db/migrations/**",
  ],
});
