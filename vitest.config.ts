import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    isolate: false,
    passWithNoTests: false,
    pool: "threads",
    projects: ["apps/hono", "packages/core"],
    // Coverage is a root-only option in a `projects` setup — running vitest
    // from inside a package (`bun hono test`) ignores everything below, so the
    // gate only exists at the repo root via `bun run test:cov`.
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text", ["text-summary", { file: "summary.txt" }], "html"],
      // Deliberately not `./coverage`, which is reserved for fallow's runtime
      // sidecar traces. Feeding fallow test coverage would make it report the
      // ADR-sanctioned untested layers as dead code.
      reportsDirectory: "./coverage/vitest",
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
      include: ["apps/hono/src/**/*.ts", "packages/core/src/**/*.ts"],
      // The denominator is fail-closed: every source file counts unless it is
      // subtracted here, so a new module lands inside the gate by default. Each
      // exclusion below is justified in ADR-0001, which is also where the
      // reasons live in prose:
      // `docs/adr/0001-unit-tests-are-pure-module-logic-and-api-routes-only.md`
      exclude: [
        "**/*.test.ts",
        "packages/core/src/apis/**",
        "packages/core/src/services/**",
        "packages/core/src/constants/**",
        "packages/core/src/types/**",
        "apps/hono/src/bun.ts",
        "apps/hono/src/node.ts",
        "apps/hono/src/instrumentation.ts",
        "apps/hono/src/core/constants/**",
        "apps/hono/src/core/types/**",
        "apps/hono/src/core/utils/evlog.ts",
        "apps/hono/src/db/**",
        "apps/hono/src/routes/middlewares/rate-limit/**",
        "apps/hono/src/auth/utils/**",
      ],
    },
  },
});
