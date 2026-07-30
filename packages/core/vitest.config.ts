import path from "node:path";

import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@test/msw": path.join(root, "../../vitest.msw.ts"),
      "@workspace/core": path.join(root, "src"),
    },
  },
  test: {
    environment: "node",
    // Tests are colocated with the functions they cover.
    include: ["src/**/*.test.ts"],
    name: "core",
    setupFiles: [path.join(root, "../../vitest.msw-setup.ts")],
  },
});
