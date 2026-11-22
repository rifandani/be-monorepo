import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, antiSlop, vitest],
  jsPlugins: ["./tools/lint/no-comments.ts"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    "comments/no-comments": "error",
    "typescript/return-await": ["error", "in-try-catch"],
    "eslint/require-await": "off",
    "sort-keys": "off",
    "no-inline-comments": "off",
    "unicorn/no-array-reduce": "off",
    "promise/prefer-await-to-callbacks": "off",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "apps/*/tests/**"],
      rules: {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-enum-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/prefer-promise-reject-errors": "off",
        "typescript/unbound-method": "off",
        "eslint/prefer-promise-reject-errors": "off",
        "unicorn/no-useless-promise-resolve-reject": "off",
      },
    },
    {
      files: ["stryker.config.mjs"],
      rules: {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-type-assertion": "off",
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "apps/*/tests/**"],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      files: ["apps/effect/**"],
      rules: {
        "unicorn/no-array-method-this-argument": "off",
        "no-redeclare": "off",
        "typescript/no-empty-interface": "off",
        "typescript/no-empty-object-type": "off",
        "unicorn/throw-new-error": "off",
      },
    },
  ],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/.agents",
    "**/.claude",
    "**/.cursor",
    "**/.repos",
    "**/repos",
    "docs/**",
    "apps/*/docs/**",
    "apps/hono/src/server/db/migrations/**",
  ],
});
