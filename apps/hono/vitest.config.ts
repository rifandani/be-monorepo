import { fileURLToPath } from "node:url";

import { config } from "@dotenvx/dotenvx";
import { defineConfig } from "vitest/config";

const { parsed } = config({
  path: fileURLToPath(new URL(".env.dev", import.meta.url)),
  processEnv: {},
});

export default defineConfig({
  test: {
    env: parsed,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    name: "hono",
    setupFiles: ["./vitest.setup.ts"],
  },
});
