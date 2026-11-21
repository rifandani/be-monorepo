import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    isolate: false,
    passWithNoTests: false,
    pool: "threads",
    projects: ["apps/hono", "apps/effect"],
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text", ["text-summary", { file: "summary.txt" }], "html"],
      reportsDirectory: "./coverage/vitest",
      thresholds: {
        perFile: true,
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
      include: ["apps/hono/src/**/*.ts", "apps/effect/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "apps/*/src/**/constants/**",
        "apps/*/src/**/types/**",
        "apps/hono/src/app/bun.ts",
        "apps/hono/src/app/node.ts",
        "apps/hono/src/server/instrumentation.ts",
        "apps/effect/src/app/main.ts",
        "apps/effect/src/app/bun.ts",
        "apps/effect/src/app/node.ts",
        "apps/effect/src/shared/config.ts",
        "apps/effect/src/server/observability.ts",
        "apps/hono/src/server/observability/evlog.ts",
        "apps/hono/src/server/db/**",
        "apps/hono/src/server/middleware/auth.ts",
        "apps/hono/src/server/middleware/rate-limit/index.ts",
        "apps/hono/src/server/middleware/rate-limit/postgres-storage.ts",
        "apps/hono/src/server/auth.ts",
      ],
    },
  },
});
