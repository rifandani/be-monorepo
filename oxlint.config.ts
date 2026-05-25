import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, vitest],
  ignorePatterns: ["apps/hono/src/db/migrations/**"],
  rules: {
    "no-inline-comments": "off",
    "promise/prefer-await-to-callbacks": "off",
    "sort-keys": "off",
    "unicorn/no-array-reduce": "off",
  },
});
