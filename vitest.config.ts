import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    isolate: false,
    passWithNoTests: false,
    pool: "threads",
    projects: ["apps/hono", "apps/effect"],
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
      include: ["apps/hono/src/**/*.ts", "apps/effect/src/**/*.ts"],
      // The denominator is fail-closed: every source file counts unless it is
      // subtracted here, so a new module lands inside the gate by default. Each
      // exclusion below is justified in ADR-0001, which is also where the
      // reasons live in prose:
      // `docs/adr/0001-unit-tests-are-pure-module-logic-and-api-routes-only.md`
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
        "apps/hono/src/server/middleware/rate-limit/**",
        "apps/hono/src/server/auth.ts",
      ],
    },
  },
});
