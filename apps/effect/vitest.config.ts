import { defineConfig } from "vitest/config";

// Deliberately without the `dotenvx` block that `apps/hono/vitest.config.ts`
// carries. Hono validates its environment at module load, so the values have to
// exist before the first import. Here `Config` resolves inside the layer, at
// layer construction, so a test that needs a value states it with a
// `ConfigProvider` of its own (see the cors policy in `tests/app.test.ts`).
// Adding an env loader would replace that with an ambient dependency.
export default defineConfig({
  test: {
    environment: "node",
    // `src/**` holds colocated unit tests for pure modules; `tests/**` holds
    // the endpoint tests, driven through the in-memory `HttpApiTest` client and
    // the composed `app` layer. Same split as `apps/hono`.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    name: "effect",
  },
});
