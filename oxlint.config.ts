import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, antiSlop, vitest],
  rules: {
    "sort-keys": "off",
    "no-inline-comments": "off",
    "unicorn/no-array-reduce": "off",
    "promise/prefer-await-to-callbacks": "off",
  },
  overrides: [
    {
      // Test bodies fabricate values on purpose: response bodies are cast to the shape the assertions read, `as never` reaches a specific overload, and partial doubles stand in for real collaborators. anti-slop's type-modelling rules are aimed at production signatures, so they only generate noise here.
      files: ["**/*.test.ts", "**/*.test.tsx", "apps/*/tests/**"],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
  ],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/.agents",
    "**/.claude",
    "**/.cursor",
    "**/.repos",
    "**/docs",
    "apps/hono/src/db/migrations/**",
  ],
});
