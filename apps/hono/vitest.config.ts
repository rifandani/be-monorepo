import { fileURLToPath } from "node:url";

import { config } from "@dotenvx/dotenvx";
import { defineConfig } from "vitest/config";

// `src/core/constants/env.ts` validates env at module load, so it must be
// populated before any test file is imported. Loading it here rather than
// wrapping the runner in `dotenvx run` keeps this project self-contained, so
// the root `projects` config can run it alongside packages that need no env.
//
// dotenvx is used rather than Vite's native `.env` loading so that test, dev,
// and prod share one loader — a dotenvx-encrypted `.env.dev` would otherwise
// yield ciphertext that `z.string().min(1)` accepts without complaint.
//
// `processEnv: {}` keeps the values out of this process; `test.env` is what
// hands them to the workers. A missing file does not throw — it yields `{}`,
// which fails this project's tests while leaving other projects runnable.
const { parsed } = config({
  path: fileURLToPath(new URL(".env.dev", import.meta.url)),
  processEnv: {},
});

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
      "@workspace/core": fileURLToPath(
        new URL("../../packages/core/src", import.meta.url)
      ),
    },
  },
  test: {
    env: parsed,
    environment: "node",
    // `src/**` holds colocated unit tests for non-endpoint modules (pure
    // helpers, the rate-limit store); `tests/**` holds the mock-free
    // end-to-end route tests driven through `app.request()`.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    name: "hono",
  },
});
