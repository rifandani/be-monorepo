import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    name: "effect",
    setupFiles: ["./vitest.setup.ts"],
  },
});
