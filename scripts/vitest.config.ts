import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["security/*.test.ts"],
    name: "scripts",
    setupFiles: ["./vitest.setup.ts"],
  },
});
