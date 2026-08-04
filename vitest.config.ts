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
        // Every included file clears 90 on its own, so a well-covered module
        // can no longer carry an untested one. A file that cannot reach it —
        // because its remaining branches need infrastructure the test run has
        // no access to — is excluded below and justified in ADR-0001 instead.
        perFile: true,
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
        "packages/*/src/constants/**",
        "packages/*/src/types/**",
        "packages/core/src/services/**",
        "apps/*/src/**/constants/**",
        "apps/*/src/**/types/**",
        "apps/hono/src/bun.ts",
        "apps/hono/src/node.ts",
        "apps/hono/src/instrumentation.ts",
        "apps/hono/src/core/utils/evlog.ts",
        "apps/hono/src/db/**",
        "apps/hono/src/routes/middlewares/auth.ts",
        "apps/hono/src/routes/middlewares/rate-limit/**",
        "apps/hono/src/auth/utils/**",
      ],
    },
  },
});
