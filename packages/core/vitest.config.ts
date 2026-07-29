import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Tests are colocated with the functions they cover.
    include: ["src/**/*.test.ts"],
    name: "core",
  },
});
